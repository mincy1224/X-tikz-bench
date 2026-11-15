import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../apps/server/src/config";
import { createProject, getProject, getProjectCanvas, initializeProjectStore, listProjects, saveProjectBibliography, softDeleteProject, updateProject } from "../../apps/server/src/projects/store";

let directory = "";

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "tikz-bench-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("TikZ Bench project store", () => {
  it("rejects concurrent duplicate names and permits reuse after deletion", async () => {
    const config = { ...loadConfig([]), databasePath: path.join(directory, "unique.sqlite") };
    await initializeProjectStore(config);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createProject(config, "  Same  ", "", " description ")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(7);
    await expect(createProject(config, "   ")).rejects.toMatchObject({ code: "invalid_name" });
    const project = (await listProjects(config))[0];
    expect(project.description).toBe("description");
    expect(await updateProject(config, project.id, { source: project.source, expectedRevision: 1 })).toMatchObject({ revision: 1 });
    const other = await createProject(config, "same");
    await expect(updateProject(config, other.id, { name: "Same" })).rejects.toMatchObject({ code: "duplicate_name" });
    await softDeleteProject(config, project.id);
    expect((await createProject(config, "Same")).name).toBe("Same");
  });
  it("creates, saves with optimistic revisions, and soft-deletes projects", async () => {
    const config = { ...loadConfig([]), databasePath: path.join(directory, "projects.sqlite") };
    await initializeProjectStore(config);
    const created = await createProject(config, "First canvas", "\\begin{tikzpicture}\\end{tikzpicture}");
    expect((await listProjects(config)).map((project) => project.id)).toEqual([created.id]);

    const saved = await updateProject(config, created.id, { source: "changed", expectedRevision: 1 });
    if (saved === "conflict" || saved === null) throw new Error("Expected the project update to succeed.");
    expect(saved.revision).toBe(2);
    expect(await updateProject(config, created.id, { source: "stale", expectedRevision: 1 })).toBe("conflict");

    expect(await softDeleteProject(config, created.id)).toBe(true);
    expect(await listProjects(config)).toEqual([]);
    expect((await getProject(config, created.id))?.deletedAt).not.toBeNull();
  });
  it("shares and copies the project bibliography across canvases", async () => {
    const config = { ...loadConfig([]), databasePath: path.join(directory, "bibliography.sqlite") };
    await initializeProjectStore(config);
    const project = await createProject(config, "Bibliography project");
    const bibliography = { name: "reading.bib", source: "@book{knuth1984,title={The TeXbook}}", style: "plain" };
    await saveProjectBibliography(config, project.id, bibliography);
    expect((await getProjectCanvas(config, project.id))?.bibliography).toEqual(bibliography);
    const copy = await createProject(config, "Bibliography copy", project.source, "", project.id);
    expect((await getProjectCanvas(config, copy.id))?.bibliography).toEqual(bibliography);
    await saveProjectBibliography(config, project.id, null);
    expect((await getProjectCanvas(config, project.id))?.bibliography).toBeNull();
    expect((await getProjectCanvas(config, copy.id))?.bibliography).toEqual(bibliography);
  });
});
