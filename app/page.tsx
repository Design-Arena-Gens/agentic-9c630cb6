import { RunAgentButton } from '@/app/components/run-agent-button';
import { getConfig } from '@/lib/config';
import { listPendingUploads, listVideos, VideoRecord } from '@/lib/db';

export const dynamic = 'force-dynamic';

function formatDate(value: Date | null | undefined, locale = 'en-US') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function StatusBadge({ status }: { status: VideoRecord['status'] }) {
  const colors: Record<VideoRecord['status'], string> = {
    new: 'bg-blue-100 text-blue-800',
    scheduled: 'bg-amber-100 text-amber-800',
    processing: 'bg-purple-100 text-purple-800',
    uploaded: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-rose-100 text-rose-800',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

export default async function Home() {
  const config = getConfig();
  const [pending, recent] = await Promise.all([
    listPendingUploads(),
    listVideos(50),
  ]);

  const uploaded = recent.filter((video) => video.status === 'uploaded');
  const failed = recent.filter((video) => video.status === 'failed');
  const scheduled = recent.filter((video) => video.status === 'scheduled');

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col justify-between gap-6 rounded-2xl bg-white p-8 shadow-sm md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-semibold text-zinc-900">YouTube Shorts Automation Agent</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Monitoring <code className="rounded bg-zinc-100 px-1 py-0.5">{config.contentDir}</code>
              {' '}for new shorts. Upload windows: {config.uploadWindows}. Timezone: {config.timezone}.
            </p>
          </div>
          <RunAgentButton />
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Pending Queue</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-900">{pending.length}</p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Scheduled</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-900">{scheduled.length}</p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Uploaded (recent)</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-900">{uploaded.length}</p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Failures (need review)</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-900">{failed.length}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-900">Upload Queue</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Upcoming uploads and recent history. Configure more in <code className="rounded bg-zinc-100 px-1 py-0.5">.env.local</code>.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead>
                <tr className="text-left">
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Filename</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Status</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Scheduled</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Uploaded</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Video ID</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Title</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Analytics</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium text-zinc-500">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recent.map((video) => {
                  const metadata = (video.metadata as Record<string, unknown> | null) ?? null;
                  const title = metadata && typeof metadata.title === 'string' ? metadata.title : '—';
                  const analytics = (video.analytics as Record<string, unknown> | null) ?? null;
                  const viewCountRaw = analytics?.viewCount;
                  const likeCountRaw = analytics?.likeCount;
                  const suggestions = analytics && typeof analytics.suggestions === 'string'
                    ? analytics.suggestions
                    : null;
                  const viewCount = typeof viewCountRaw === 'number'
                    ? viewCountRaw
                    : viewCountRaw != null
                      ? Number(viewCountRaw)
                      : null;
                  const likeCount = typeof likeCountRaw === 'number'
                    ? likeCountRaw
                    : likeCountRaw != null
                      ? Number(likeCountRaw)
                      : null;
                  return (
                    <tr key={`${video.id}-${video.filename}`} className="align-top">
                      <td className="px-4 py-3 font-medium text-zinc-900">{video.filename}</td>
                      <td className="px-4 py-3"><StatusBadge status={video.status} /></td>
                      <td className="px-4 py-3 text-zinc-600">{formatDate(video.scheduledAt)}</td>
                      <td className="px-4 py-3 text-zinc-600">{formatDate(video.uploadedAt)}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {video.youtubeVideoId ? (
                          <a
                            href={`https://youtube.com/shorts/${video.youtubeVideoId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {video.youtubeVideoId}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{title}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {viewCount != null ? (
                          <div className="flex flex-col text-xs text-zinc-500">
                            <span>Views: {viewCount}</span>
                            <span>Likes: {likeCount ?? '—'}</span>
                            {suggestions ? (
                              <span className="mt-2 text-zinc-600">{suggestions}</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-rose-500">{video.error ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
