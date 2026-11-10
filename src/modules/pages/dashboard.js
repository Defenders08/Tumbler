// Сборка и рендер дашборда: лента подписок + свои посты, композер, сайдбар с подписками.
// Используется и GET /dashboard, и повторный рендер с ошибкой после неудачного POST.
import { getBlogByUserId } from '../blogs/service.js';
import { listGeneralFeed, listFeedPosts, decoratePosts } from '../posts/service.js';
import { followedBlogs, followedCount } from '../social/service.js';
import { translate } from '../../lib/i18n.js';

// Вкладки ленты и запоминание последней активной.
const FEED_TABS = new Set(['general', 'subscriptions']);
const DEFAULT_FEED_TAB = 'subscriptions';
const FEED_TAB_COOKIE = 'tumbler.feed_tab';
const FEED_TAB_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

// Явный выбор вкладки сохраняется в cookie; без параметра возвращаем последнюю.
export function resolveFeedTab(req, res) {
  const requested = typeof req.query.tab === 'string' ? req.query.tab : null;
  if (FEED_TABS.has(requested)) {
    res.cookie(FEED_TAB_COOKIE, requested, {
      sameSite: 'strict',
      path: '/',
      maxAge: FEED_TAB_MAX_AGE,
    });
    return requested;
  }
  const remembered = req.cookies?.[FEED_TAB_COOKIE];
  return FEED_TABS.has(remembered) ? remembered : DEFAULT_FEED_TAB;
}

export function renderDashboardPage(ctx, req, res, opts = {}) {
  const lang = req.lang;
  const blog = getBlogByUserId(ctx.db, req.user.id);
  if (!blog) {
    return res.status(500).render('pages/errors/error', {
      title: translate(lang, 'errors.500_title'),
      errorText: translate(lang, 'errors.500_text'),
    });
  }

  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const tab = resolveFeedTab(req, res);
  const feed = tab === 'general'
    ? listGeneralFeed(ctx.db, { page, perPage: 10 })
    : listFeedPosts(ctx.db, req.user.id, blog.id, { page, perPage: 10 });
  const { rows, total, pages } = feed;
  const posts = decoratePosts(ctx.db, rows, { userId: req.user.id, blogId: blog.id });
  const draftsCount = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE blog_id = ? AND status = 'draft'")
    .get(blog.id).n;

  const subscriptions = followedBlogs(ctx.db, req.user.id, 10);
  const subscriptionsCount = followedCount(ctx.db, req.user.id);
  const followingNobody = subscriptionsCount === 0;

  const flashKey = req.query.created
    ? 'dashboard.created'
    : req.query.saved
      ? 'dashboard.draft_saved'
      : req.query.deleted
        ? 'drafts.deleted'
        : null;
  const commentError = typeof req.query.commentError === 'string'
    ? translate(lang, req.query.commentError)
    : null;

  res.status(opts.status ?? 200).render('pages/dashboard', {
    title: translate(lang, 'dashboard.title'),
    blog,
    posts,
    page,
    pages,
    total,
    tab,
    feedBase: `/dashboard?tab=${tab}`,
    feedHint: translate(lang, tab === 'general' ? 'dashboard.general_hint' : 'dashboard.feed_hint'),
    draftsCount,
    subscriptions,
    subscriptionsCount,
    followingNobody,
    flash: flashKey ? translate(lang, flashKey) : null,
    commentError,
    composerError: opts.composerError ?? null,
    composerErrorNote: opts.composerErrorNote ?? null,
    openType: opts.openType ?? null,
    values: opts.values ?? null,
  });
}
