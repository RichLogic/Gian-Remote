import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, readlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve(existsSync('delivery/remote/scripts/deploy.sh') ? 'delivery/remote/scripts/deploy.sh' : 'scripts/deploy.sh');
const oldRevision = 'a'.repeat(40); const newRevision = 'b'.repeat(40); const schema = 'c'.repeat(64);
function fixture(t, changedSchema = false) {
  const base = mkdtempSync(join(tmpdir(), 'gian-remote-deploy-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'); mkdirSync(bin);
  writeFileSync(join(base, 'runtime.env'), 'GIAN_REMOTE_ADMIN_TOKEN=fake-only\n');
  for (const revision of [oldRevision, newRevision]) {
    const dir = join(base, 'releases', revision); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'compose.yaml'), 'services: {}\n');
    writeFileSync(join(dir, 'deploy.env'), 'REMOTE_IMAGE=fake\n');
    writeFileSync(join(dir, 'data-schema'), revision === oldRevision && changedSchema ? 'd'.repeat(64) : schema);
  }
  symlinkSync(`releases/${oldRevision}`, join(base, 'current'));
  const put = (name, body) => writeFileSync(join(bin, name), '#!' + process.execPath + '\n' + body, { mode: 0o755 });
  put('flock', 'process.exit(0);'); put('sleep', 'process.exit(0);');
  put('mv', 'require("fs").renameSync(process.argv.at(-2),process.argv.at(-1));');
  put('docker', `const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.DEPLOY_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='compose'&&a.includes('ps')){console.log(a[a.indexOf('-f')+1].split('/').at(-2));}
if(a[0]==='inspect'){console.log(process.env.FAIL_CANDIDATE==='1'&&a.at(-1)==='${newRevision}'?'unhealthy':'healthy');}`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_LOG: join(base, 'calls.jsonl'), REMOTE_DEPLOY_HEALTH_ATTEMPTS: '1' };
  delete env.GIAN_ALLOW_DESKTOP_E2E;
  return { base, env, run: fail => spawnSync('bash', [script, base, newRevision, `ghcr.io/richlogic/gian-remote@sha256:${'e'.repeat(64)}`, schema], { env: { ...env, FAIL_CANDIDATE: fail ? '1' : '0' }, encoding: 'utf8' }), calls: () => readFileSync(env.DEPLOY_LOG, 'utf8').trim().split('\n').map(JSON.parse) };
}
test('deployment backs up stopped data, switches only after health, and retry is idempotent', t => {
  const f = fixture(t); const result = f.run(false);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(readlinkSync(join(f.base, 'current')), `releases/${newRevision}`);
  const calls = f.calls();
  const stop = calls.findIndex(a => a.includes('stop'));
  const backup = calls.findIndex(a => a[0] === 'run');
  const start = calls.findIndex(a => a.includes('up'));
  assert.ok(stop >= 0 && backup > stop && start > backup);
  assert.equal(f.run(false).status, 0);
  assert.equal(f.calls().filter(a => a.includes('up')).length, 1);
});
test('failed health restores previous image when migration fingerprint is unchanged', t => {
  const f = fixture(t); const result = f.run(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /previous image restored/);
  assert.equal(readlinkSync(join(f.base, 'current')), `releases/${oldRevision}`);
  const starts = f.calls().filter(a => a.includes('up'));
  assert.equal(starts.length, 2);
  assert.ok(starts[1].some(a => a.includes(oldRevision)));
});
test('failed migration-changing deployment stops instead of running old code on new data', t => {
  const f = fixture(t, true); const result = f.run(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /automatic rollback withheld/);
  assert.equal(f.calls().filter(a => a.includes('up')).length, 1);
  assert.equal(readlinkSync(join(f.base, 'current')), `releases/${oldRevision}`);
});
