/**
 * GitHub API service for Agent tools and IDE features.
 * Uses the GitHub REST API with a personal access token.
 */
export class GitHubService {
  private getToken(startsWith: string = ''): string | null {
    // Token is stored encrypted by the store service
    return startsWith || null; // caller passes decrypted value
  }

  private async fetch(token: string, path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ai-code-ide/1.0',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ── Issues ──

  async listIssues(token: string, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    const data = await this.fetch(token, `/repos/${owner}/${repo}/issues?state=${state}&per_page=30`);
    return (data || []).map((i: any) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: (i.labels || []).map((l: any) => l.name),
      assignee: i.assignee?.login || null,
      created_at: i.created_at,
      updated_at: i.updated_at,
      html_url: i.html_url,
    }));
  }

  async getIssue(token: string, owner: string, repo: string, number: number) {
    const i = await this.fetch(token, `/repos/${owner}/${repo}/issues/${number}`);
    return {
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      labels: (i.labels || []).map((l: any) => l.name),
      comments: i.comments,
      html_url: i.html_url,
    };
  }

  async createIssue(token: string, owner: string, repo: string, title: string, body: string = '', labels: string[] = []) {
    const i = await this.fetch(token, `/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels }),
    });
    return { number: i.number, html_url: i.html_url };
  }

  async listIssueComments(token: string, owner: string, repo: string, number: number) {
    const data = await this.fetch(token, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=30`);
    return (data || []).map((c: any) => ({
      id: c.id,
      user: c.user.login,
      body: c.body,
      created_at: c.created_at,
    }));
  }

  async addIssueComment(token: string, owner: string, repo: string, number: number, body: string) {
    await this.fetch(token, `/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }

  // ── Pull Requests ──

  async listPRs(token: string, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    const data = await this.fetch(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=20`);
    return (data || []).map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      user: pr.user.login,
      base: pr.base.ref,
      head: pr.head.ref,
      html_url: pr.html_url,
    }));
  }

  async getPR(token: string, owner: string, repo: string, number: number) {
    const pr = await this.fetch(token, `/repos/${owner}/${repo}/pulls/${number}`);
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      mergeable: pr.mergeable,
      base: pr.base.ref,
      head: pr.head.ref,
      user: pr.user.login,
      html_url: pr.html_url,
      diff_url: pr.diff_url,
    };
  }

  async getPRDiff(token: string, owner: string, repo: string, number: number): Promise<string> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ai-code-ide/1.0',
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return res.text();
  }

  async createPR(token: string, owner: string, repo: string, title: string, head: string, base: string, body: string = '') {
    const pr = await this.fetch(token, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head, base, body }),
    });
    return { number: pr.number, html_url: pr.html_url };
  }

  // ── CI / Actions ──

  async listWorkflowRuns(token: string, owner: string, repo: string, branch?: string) {
    let url = `/repos/${owner}/${repo}/actions/runs?per_page=10`;
    if (branch) url += `&branch=${encodeURIComponent(branch)}`;
    const data = await this.fetch(token, url);
    return (data.workflow_runs || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch,
      html_url: r.html_url,
      created_at: r.created_at,
    }));
  }

  // ── Search ──

  async searchCode(token: string, query: string, owner?: string, repo?: string) {
    let q = query;
    if (owner && repo) q += `+repo:${owner}/${repo}`;
    else if (owner) q += `+user:${owner}`;
    const data = await this.fetch(token, `/search/code?q=${encodeURIComponent(q)}&per_page=10`);
    return (data.items || []).map((item: any) => ({
      path: item.path,
      repo: item.repository.full_name,
      html_url: item.html_url,
    }));
  }

  // ── Repo info ──

  async getRepo(token: string, owner: string, repo: string) {
    const r = await this.fetch(token, `/repos/${owner}/${repo}`);
    return {
      full_name: r.full_name,
      description: r.description,
      default_branch: r.default_branch,
      stars: r.stargazers_count,
      open_issues: r.open_issues_count,
      language: r.language,
      html_url: r.html_url,
      clone_url: r.clone_url,
      ssh_url: r.ssh_url,
    };
  }

  /** Derive owner/repo from git remote origin URL */
  parseRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git
    const httpsMatch = remoteUrl.match(/github\.com[/:](.+?)\/(.+?)(\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2].replace(/\.git$/, '') };
    }
    return null;
  }
}