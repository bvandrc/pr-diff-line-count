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

/** A comment as `listComments` returns it, which is what the source pages through. */
type IssueComment = Awaited<
  ReturnType<ReturnType<typeof getOctokit>['rest']['issues']['listComments']>
>['data'][number]

/** Puts the run on a pull request carrying the given comments. */
const mockPullRequest = (comments: Pick<IssueComment, 'id' | 'body'>[]) => {
  context.payload.pull_request = { number: 7 }
  Object.assign(context.repo, REPO)
  octokit.paginate.mockResolvedValue(comments)
}

describe('postStickyComment', () => {
  beforeEach(() => {
    context.payload = {}
  })

  it('posts a comment carrying the marker that finds it again', async () => {
    mockPullRequest([])

    await postStickyComment({ body: '### Report' })

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      ...REPO,
      issue_number: 7,
      body: `### Report\n\n${MARKER}`,
    })
  })

  it('edits the one it already left rather than adding another', async () => {
    mockPullRequest([
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
    mockPullRequest([{ id: 2, body: `### Same\n\n${MARKER}` }])

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
})
