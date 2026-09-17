import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const protectedWorkflowUrl = new URL('../../.github/workflows/protected-fixed-pr-admission.yml', import.meta.url);
const releaseWorkflowUrl = new URL('../../.github/workflows/release-gate.yml', import.meta.url);
const profileUrl = new URL('../fixed-pr-admission.profile.json', import.meta.url);
const verifierUrl = new URL('../fixed-pr-admission.mjs', import.meta.url);

const SIX_GOVERNANCE_PATHS = [
  '.github/workflows/protected-fixed-pr-admission.yml',
  '.github/workflows/release-gate.yml',
  'scripts/__tests__/ef94-ci-release-gate.test.mjs',
  'scripts/__tests__/fixed-pr-admission.test.mjs',
  'scripts/fixed-pr-admission.mjs',
  'scripts/fixed-pr-admission.profile.json',
];

async function text(url) {
  return readFile(url, 'utf8');
}

function assertProtectedAuthorityWorkflow(workflow, name, jobName) {
  assert.match(workflow, new RegExp(`^name: ${name}$`, 'm'));
  assert.match(workflow, /^  pull_request_target:\n    types: \[opened, reopened, synchronize, ready_for_review\]\n    branches:\n      - dev$/m);
  assert.match(workflow, /^permissions:\n  contents: read\n  pull-requests: read$/m);
  assert.match(workflow, new RegExp(`^    name: ${jobName}$`, 'm'));
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.equal((workflow.match(/^\s*uses:/gm) ?? []).length, 1);
  assert.match(workflow, /repository: susiexuejing\/chat-app/);
  assert.match(workflow, /ref: refs\/heads\/dev/);
  assert.match(workflow, /path: authority/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /EXPECTED_WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(workflow, /AUTHORITY_SHA="\$\(git rev-parse --verify HEAD\)"/);
  assert.match(workflow, /test "\$AUTHORITY_SHA" = "\$EXPECTED_WORKFLOW_SHA"/);
  assert.match(workflow, /EF_AUTHORITY_SNAPSHOT_SHA: \$\{\{ steps\.authority_snapshot\.outputs\.sha \}\}/);
  assert.match(workflow, /working-directory: authority/);
  assert.match(workflow, /run: node scripts\/fixed-pr-admission\.mjs/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request|pull_request\.head|path: candidate|checkout.*candidate/i);
  assert.doesNotMatch(workflow, /permissions:[\s\S]*\b(write|id-token):|secrets\.|pull_request_target[\s\S]*\b(pnpm|npm|yarn|install|cache|restore|artifact|deploy|merge|curl|wget|ssh)\b/i);
}

test('both governance gates are protected-base pull_request_target workflows with exact read-only permissions', async () => {
  const [protectedWorkflow, releaseWorkflow] = await Promise.all([
    text(protectedWorkflowUrl),
    text(releaseWorkflowUrl),
  ]);
  assertProtectedAuthorityWorkflow(protectedWorkflow, 'Protected Fixed PR Admission', 'Protected fixed successor admission');
  assertProtectedAuthorityWorkflow(releaseWorkflow, 'Release Gate', 'EF-94 Release Gate');
});

test('both gates resolve protected dev once and execute the verifier from that same immutable snapshot', async () => {
  const workflows = await Promise.all([text(protectedWorkflowUrl), text(releaseWorkflowUrl)]);
  for (const workflow of workflows) {
    assert.equal((workflow.match(/ref: refs\/heads\/dev/g) ?? []).length, 1);
    assert.equal((workflow.match(/id: authority_snapshot/g) ?? []).length, 1);
    assert.equal((workflow.match(/EF_AUTHORITY_SNAPSHOT_SHA:/g) ?? []).length, 1);
    assert.equal((workflow.match(/node scripts\/fixed-pr-admission\.mjs/g) ?? []).length, 1);
    assert.doesNotMatch(workflow, /github\.event\.pull_request\.base\.sha/);
  }
});

test('privileged release gate produces admission only and contains no product execution path', async () => {
  const workflow = await text(releaseWorkflowUrl);
  assert.doesNotMatch(workflow, /test:release|run-approved-targeted-regressions|jest|tsc|node_modules|package\.json|pnpm-lock|candidate/);
  assert.doesNotMatch(workflow, /workflow_dispatch|^  push:|^  pull_request:/m);
});

test('Base-owned v5 profile preserves EF-177 legacy ancestry and freezes EF-107 squash-anchor identity', async () => {
  const profile = JSON.parse(await text(profileUrl));
  assert.equal(profile.schemaVersion, 5);
  assert.equal(profile.kind, 'base-owned-current-base-integration-registry');
  assert.deepEqual(profile.authority, {
    repository: 'susiexuejing/chat-app',
    targetBranch: 'dev',
    governanceSelfAdmission: 'forbidden',
    recordOrder: 'id-lf-ascending',
  });
  assert.equal(profile.records.length, 3);
  const ef107 = profile.records[0];
  assert.equal(ef107.id, 'ef-107-1d61b510-current-base-v1');
  assert.equal(ef107.integration.headSha, '1d61b510043e76b295aca9d989a961a20e590d1b');
  assert.equal(ef107.integration.parentSha, '30d50f74d36094e1a7a34fa5b291b94bcc71098a');
  assert.equal(ef107.integration.sourceBranch, 'cell2/ef107-currentbase-1d61b510');
  assert.equal(ef107.integration.pathDigest, '861c3f91719e85e8bfaf707ac587fbf528c1a7c4197744ac83f5aee6f98b5483');
  assert.deepEqual(ef107.protectedGovernanceChain, {
    kind: 'squash-merge',
    anchorBaseSha: '589ff543efd25df794d10ca8d6bd95a05881b3b6',
    anchorHeadSha: '99faca39e2cfa517e8ab9da12e113987291b3c77',
    anchorSourceBranch: 'cell2/ef177-advanced-base-governance-99faca39',
    anchorMergeSha: '82e26d45213068130c226cadc1acf76f99856843',
    anchorMergeParentShas: ['589ff543efd25df794d10ca8d6bd95a05881b3b6'],
    anchorPaths: [
      'scripts/__tests__/ef94-ci-release-gate.test.mjs',
      'scripts/__tests__/fixed-pr-admission.test.mjs',
      'scripts/fixed-pr-admission.mjs',
      'scripts/fixed-pr-admission.profile.json',
    ],
    anchorPathCount: 4,
    anchorPathDigest: '6b7db69946230e2cbfa8d50d9d10e823de984b88092cb66d86490086acdcc763',
    permanentlyRejectedCandidateShas: ['a1577f161d644dddcda6b6c6485a344d2869e9ae'],
    zeroProductPathOverlap: true,
  });
  const record = profile.records[1];
  assert.equal(record.integration.headSha, 'fa24d37ddb9d57a97708e1b5bc9cfaadf0e11410');
  assert.equal(record.integration.parentSha, 'fed71b289db431370f8789163d7d3c5602936689');
  assert.equal(record.integration.sourceBranch, 'cell1/ef177-currentbase-fa24d37');
  assert.equal(record.integration.targetBranch, 'dev');
  assert.equal(record.integration.pathCount, 3);
  const chain = record.protectedGovernanceChain;
  assert.equal(chain.kind, 'legacy-two-parent-merge');
  assert.equal(chain.historicProductBaseSha, 'fed71b289db431370f8789163d7d3c5602936689');
  assert.equal(chain.registryMergeSha, 'd95ecc6eb125f069b3510f2875e0b620a330bc52');
  assert.equal(chain.correctiveMergeSha, 'b968adb3318d3f91aba34d14d3511be77f03d438');
  assert.equal(chain.authorityBootstrapParentSha, 'b968adb3318d3f91aba34d14d3511be77f03d438');
  assert.deepEqual(chain.authorityBootstrapPaths, SIX_GOVERNANCE_PATHS);
  assert.equal(chain.authorityBootstrapPathDigest, 'f2f45619034080ba56c1c183b9496061f507577388125e97560cb6795d630b76');
  assert.deepEqual(chain.permanentlyRejectedCandidateShas, ['a1577f161d644dddcda6b6c6485a344d2869e9ae']);
  assert.deepEqual(profile.records[2], {
    id: 'ef-235-pr-138-feda824d-protected-dev-v1',
    ticket: 'EF-235',
    pullRequest: {
      number: 138,
      sourceBranch: 'candidate/ef235-owner-binding-bootstrap-successor',
      sourceRepository: 'susiexuejing/chat-app',
      targetBranch: 'dev',
      targetRepository: 'susiexuejing/chat-app',
    },
    identity: {
      headSha: 'feda824d23d3e1291edf0b6dfefcc13fc8f8bc3b',
      parentSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      baseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      mergeBaseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      patchId: 'f4cd68ba3ac0e29df59f03237e60d77a6f83ae50',
      paths: [
        'server/src/__tests__/ef75-chat-ownership.test.ts',
        'server/src/index.ts',
        'server/src/storage/database/protected-owner-binding-bootstrap.ts',
      ],
      pathCount: 3,
      pathDigest: '790adbe4059d695e918bbaec0c23e4c78428ae4d767a42ee1e5438e49f517896',
    },
    independentQa: {
      kind: 'independent-r2',
      headSha: 'feda824d23d3e1291edf0b6dfefcc13fc8f8bc3b',
      baseSha: 'c5e7ee8f7ef11b1ddc9ef221beb96f229c88d557',
      pathDigest: '790adbe4059d695e918bbaec0c23e4c78428ae4d767a42ee1e5438e49f517896',
      passed: 12,
      total: 12,
    },
  });
});

test('verifier treats PR fields only as fixed identity data and never reads Candidate files', async () => {
  const verifier = await text(verifierUrl);
  assert.match(verifier, /eventFieldsUsedAsDataOnly/);
  assert.match(verifier, /candidateFilesRead/);
  assert.match(verifier, /candidate file content was read by privileged admission/);
  assert.match(verifier, /candidate code executed before admission/);
  assert.doesNotMatch(verifier, /gitPatchId|--candidate-root|releaseGateArguments/);
  assert.doesNotMatch(verifier, /pullRequest\.base\.sha[^\n]*(git|authority)|git\(\[[^\]]*pullRequest/);
});

test('verifier requires the exact registry, corrective, and single future Bootstrap merge topology', async () => {
  const verifier = await text(verifierUrl);
  assert.match(verifier, /registry merge parent topology mismatch/);
  assert.match(verifier, /corrective merge parent topology mismatch/);
  assert.match(verifier, /authority Bootstrap merge parent topology mismatch/);
  assert.match(verifier, /authority Bootstrap Candidate must be single-parent corrective merge/);
  assert.match(verifier, /authority Bootstrap merge tree/);
  assert.match(verifier, /authority Bootstrap chain commit count/);
  assert.match(verifier, /authority Bootstrap governance path set or digest mismatch/);
  assert.match(verifier, /permanently rejected governance candidate/);
});
