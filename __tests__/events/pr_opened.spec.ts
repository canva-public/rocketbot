import { isMarkedPipeline } from '../../src/events/pr_opened';
import gitUrlParse from 'git-url-parse';

describe('isMarkedPipeline', () => {
  it('discards if not marked', () => {
    expect.hasAssertions();
    const sshUrl = gitUrlParse('git@github.com:org/test-repo.git');
    expect(
      isMarkedPipeline(sshUrl, {
        repository: 'git@github.com:org/test-repo.git',
      }),
    ).toBe(false);
  });
  it('discards if repos do not match', () => {
    expect.hasAssertions();
    const sshUrl = gitUrlParse('git@github.com:org/A.git');
    expect(
      isMarkedPipeline(sshUrl, {
        repository: 'org-2562356@github.com:org/B.git',
        env: {
          GH_CONTROL_IS_VALID_BRANCH_BUILD: 'true',
        },
      }),
    ).toBe(false);
  });
  it('works for enterprise SSH urls', () => {
    expect.hasAssertions();
    const sshUrl = gitUrlParse('org-123@github.com:org/test-repo.git');
    expect(
      isMarkedPipeline(sshUrl, {
        repository: 'org-123@github.com:org/test-repo.git',
        env: {
          GH_CONTROL_IS_VALID_BRANCH_BUILD: 'true',
        },
      }),
    ).toBe(true);
  });
});
