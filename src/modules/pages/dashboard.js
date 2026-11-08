// Сборка и рендер дашборда: лента подписок + свои посты, композер, сайдбар с подписками.
// Используется и GET /dashboard, и повторный рендер с ошибкой после неудачного POST.
import { getBlogByUserId } from '../blogs/service.js';
import { listFeedPosts, decoratePosts } from '../posts/service.js';
import { followedBlogs, followedCount } from '../social/service.js';
import { translate } from '../../lib/i18n.js';

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
  const { rows, total, pages } = listFeedPosts(ctx.db, req.user.id, blog.id, { page, perPage: 10 });
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
