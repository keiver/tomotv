import { jobApplied, jobApplying, jobApplyFailed, makeJob, runJobs, withLanguage, withQuery } from "@/services/subtitles/jobs";
import type { SubtitleHit, SubtitleJob } from "@/services/subtitles/types";
import type { JellyfinVideoItem } from "@/types/jellyfin";

function episode(index: number, streams: unknown[] = []): JellyfinVideoItem {
  return {
    Id: `e${index}`,
    Name: `Episode ${index}`,
    Type: "Episode",
    Path: `/tv/Show/S01E0${index}.mkv`,
    SeriesName: "Show",
    ParentIndexNumber: 1,
    IndexNumber: index,
    MediaStreams: streams,
  } as unknown as JellyfinVideoItem;
}

function hit(id: string, over: Partial<SubtitleHit> = {}): SubtitleHit {
  return {
    id,
    source: "podnapisi",
    name: id,
    language: "en",
    format: "",
    hashMatch: false,
    forced: false,
    hearingImpaired: false,
    machineTranslated: false,
    rating: null,
    downloads: null,
    author: "",
    ...over,
  };
}

const jobsFor = (items: JellyfinVideoItem[]): SubtitleJob[] => items.map((item) => makeJob(item, "en"));

describe("makeJob", () => {
  it("makes an idle job for the video, even one already subtitled in the language", () => {
    const job = makeJob(episode(1, [{ Type: "Subtitle", Codec: "subrip", Language: "eng" }]), "en");
    expect(job).toMatchObject({ label: "S01 E01", title: "Episode 1", language: "en", status: "idle" });
    expect(job.item.Id).toBe("e1");
  });
});

describe("job transitions", () => {
  const jobs = jobsFor([episode(1), episode(2)]);

  it("a new language resets every job", () => {
    const applied = jobApplied(jobs, 0, { where: "device", language: "en" });
    const reset = withLanguage(applied, "fr");
    expect(reset.every((job) => job.language === "fr" && job.status === "idle" && job.applied === null)).toBe(true);
  });

  it("a new query resets one job and its label", () => {
    const changed = withQuery(jobs, 1, { kind: "episode", keywords: "Other Show", season: 2, episode: 7, fileName: "x" });
    expect(changed[1]).toMatchObject({ label: "S02 E07", status: "idle" });
    expect(changed[0]).toBe(jobs[0]);
  });

  it("an apply that fails returns the job to its results with the error and keeps the pick for the error line", () => {
    const applying = jobApplying(jobs, 0, hit("a"));
    expect(applying[0].status).toBe("applying");
    const failed = jobApplyFailed(applying, 0, "refused");
    expect(failed[0]).toMatchObject({ status: "found", picked: hit("a"), error: "refused" });
  });
});

describe("runJobs", () => {
  it("searches every idle job a few at a time and reports each change", async () => {
    const jobs = jobsFor([episode(1), episode(2), episode(3), episode(4)]);
    let inFlight = 0;
    let peak = 0;
    const reports: { index: number; status: string }[] = [];
    const result = await runJobs(
      jobs,
      async (job) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (job.item.Id === "e2") throw new Error("boom");
        return { hits: job.item.Id === "e3" ? [] : [hit(job.item.Id)], note: null };
      },
      (next, index) => reports.push({ index, status: next[index].status }),
      () => true,
      2,
    );
    expect(peak).toBe(2);
    expect(result.map((job) => job.status)).toEqual(["found", "failed", "none", "found"]);
    expect(result[1].error).toBe("boom");
    expect(reports.length).toBe(8);
    expect(reports.filter((report) => report.status === "searching").map((report) => report.index)).toEqual([0, 1, 2, 3]);
    expect(reports.filter((report) => report.status !== "searching")).toEqual([
      { index: 0, status: "found" },
      { index: 1, status: "failed" },
      { index: 2, status: "none" },
      { index: 3, status: "found" },
    ]);
  });

  it("stops starting searches once the caller has left", async () => {
    const jobs = jobsFor([episode(1), episode(2), episode(3)]);
    let alive = true;
    let searches = 0;
    const result = await runJobs(
      jobs,
      async () => {
        searches += 1;
        alive = false;
        return { hits: [], note: null };
      },
      () => undefined,
      () => alive,
      1,
    );
    expect(searches).toBe(1);
    expect(result[0].status).toBe("searching");
  });
});
