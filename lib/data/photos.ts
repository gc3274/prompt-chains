import "server-only";
import { IMAGE_BUCKET } from "@/lib/captions";
import { emptyPastEnd } from "@/lib/params";
import { parseTopic, type Topic } from "@/lib/roasts";
import { photoRange } from "@/lib/runs";
import { adminDb } from "@/lib/supabase/admin";

// The photos a chain can run on: every post with a topic, newest first.
// Legacy caption photos have no topic, so no panel can roast them. The
// uploader's note is never read here: it reaches only the prompt, which the
// run's page shows.

const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);

type PhotoRow = { id: string; image_path: string; topic: string; created_at: string };

export type PhotoChoice = { id: string; imageUrl: string; topic: Topic; createdAt: string };

export async function listPhotoChoices(q: {
  topic: Topic | null;
  page: number;
}): Promise<{ rows: PhotoChoice[]; total: number }> {
  const db = await adminDb();

  let query = db
    .from("images")
    .select("id, image_path, topic, created_at", { count: "exact" })
    .not("topic", "is", null);
  if (q.topic !== null) query = query.eq("topic", q.topic);

  const [from, to] = photoRange(q.page);
  // id last, so pages never overlap when two rows share a timestamp
  const { data, error, count } = emptyPastEnd(
    await query
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
      .overrideTypes<PhotoRow[], { merge: false }>(),
  );
  if (error) throw fail("Photos", error);

  const bucket = db.storage.from(IMAGE_BUCKET);
  return {
    rows: (data ?? []).flatMap((r) => {
      const topic = parseTopic(r.topic);
      return topic
        ? [{ id: r.id, imageUrl: bucket.getPublicUrl(r.image_path).data.publicUrl, topic, createdAt: r.created_at }]
        : [];
    }),
    total: count ?? 0,
  };
}
