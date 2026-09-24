import { info } from '@actions/core'
import { context, getOctokit } from '@actions/github'

import { postStickyComment } from '../sticky-comment.ts'

const MARKER = '<!-- pr-diff-line-count -->'
const REPO = { owner: 'bvandrc', repo: 'pr-diff-line-count' }

const { octokit } = vi.hoisted(() => ({
  octokit: {
    paginate: vi.fn(),
    rest: {
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(),
        updateComment: vi.fn(),
      },
    },
  },
}))

vi.mock('@actions/core', () => ({
  getInput: vi.fn(() => 'token'),
  info: vi.fn(),
}))
vi.mock('@actions/github', () => ({
  context: { payload: {}, repo: {} },
  getOctokit: vi.fn(() => octokit),
}))

/** Puts the run on a pull request carrying the given comments. */
const onPullRequest = (comments: { id: number; body: string }[]) => {
  context.payload.pull_request = { number: 7 }
  Object.assign(context.repo, REPO)
  octokit.paginate.mockResolvedValue(comments)
}

describe('postStickyComment', () => {
  beforeEach(() => {
    context.payload = {}
  })

  it('posts a comment carrying the marker that finds it again', async () => {
    onPullRequest([])

    await postStickyComment({ body: '### Report' })

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      ...REPO,
      issue_number: 7,
      body: `### Report\n\n${MARKER}`,
    })
  })

  it('edits the one it already left rather than adding another', async () => {
    onPullRequest([
      { id: 1, body: 'someone else' },
      { id: 2, body: `### Old\n\n${MARKER}` },
    ])

    await postStickyComment({ body: '### New' })

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      ...REPO,
      comment_id: 2,
      body: `### New\n\n${MARKER}`,
    })
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('writes nothing when the comment already says this', async () => {
    onPullRequest([{ id: 2, body: `### Same\n\n${MARKER}` }])

    await postStickyComment({ body: '### Same' })

    // A push that changes no counts should not bump the comment's timestamp.
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith('Comment is already up to date.')
  })

  it('does nothing at all outside a pull request', async () => {
    await postStickyComment({ body: '### Report' })

    expect(getOctokit).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      'Not a pull request — skipping the comment.'
    )
  })

  it('pages through the comments, rather than reading only the first page', async () => {
    onPullRequest([])

    await postStickyComment({ body: '### Report' })

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.issues.listComments,
      expect.objectContaining({ ...REPO, issue_number: 7, per_page: 100 })
    )
  })
})
