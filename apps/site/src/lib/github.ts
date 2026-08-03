export async function fetchGithubStars(repo: string): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count: number };
    return data.stargazers_count;
  } catch {
    // Build-time-only enhancement -- if the GitHub API is unreachable or
    // rate limited, callers still render, just without a count.
    return null;
  }
}
