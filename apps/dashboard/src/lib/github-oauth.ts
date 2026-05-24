export type GithubCallbackResult = {
  status: 'connected' | null
  error: string | null
  handled: boolean
}

export function parseGithubCallback(searchParams: URLSearchParams): GithubCallbackResult {
  const github = searchParams.get('github')
  const githubError = searchParams.get('github_error')

  if (github === 'connected') {
    return { status: 'connected', error: null, handled: true }
  }
  if (githubError) {
    return { status: null, error: githubError, handled: true }
  }
  return { status: null, error: null, handled: false }
}
