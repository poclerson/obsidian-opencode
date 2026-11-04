/** Runtime stub used only by Vitest; tests replace it with `vi.mock("obsidian")`. */
export async function requestUrl(): Promise<never> {
  throw new Error("obsidian.requestUrl was not mocked in this test");
}
