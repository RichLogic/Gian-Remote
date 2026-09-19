import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReleaseReceipt } from '../scripts/release-metadata.mjs';
import { deploymentTarget } from '../scripts/deploy-ssh.mjs';

test('deployment accepts only exact stable release source and immutable owned image', () => {
  const expected = { repository: 'RichLogic/Gian-Remote', tag: 'v1.2.3', revision: 'a'.repeat(40) };
  const receipt = { schema: 1, repository: expected.repository, tag: expected.tag, version: '1.2.3', sourceCommit: expected.revision, image: `ghcr.io/richlogic/gian-remote@sha256:${'b'.repeat(64)}`, dataSchema: 'c'.repeat(64) };
  assert.equal(validateReleaseReceipt(receipt, expected), receipt);
  for (const change of [{ image: 'ghcr.io/richlogic/gian-remote:latest' }, { sourceCommit: 'd'.repeat(40) }, { image: `ghcr.io/other/remote@sha256:${'b'.repeat(64)}` }, { tag: 'v1.2.3-beta1' }, { dataSchema: '' }]) assert.throws(() => validateReleaseReceipt({ ...receipt, ...change }, expected));
});

test('SSH deployment rejects shell injection, broad paths and missing target information', () => {
  const env = { REMOTE_SSH_HOST: 'remote.example.com', REMOTE_SSH_USER: 'deploy', REMOTE_DEPLOY_DIR: '/opt/gian-remote' };
  assert.deepEqual(deploymentTarget(env), { host: 'remote.example.com', user: 'deploy', directory: '/opt/gian-remote', port: '22' });
  for (const change of [{ REMOTE_SSH_HOST: 'host;touch /tmp/x' }, { REMOTE_DEPLOY_DIR: '/opt' }, { REMOTE_DEPLOY_DIR: '/opt/../etc' }, { REMOTE_SSH_USER: '-oProxyCommand=anything' }, { REMOTE_SSH_PORT: '65536' }]) assert.throws(() => deploymentTarget({ ...env, ...change }));
});
