// scratch/verify_context_restoration.ts

import { prisma } from '../lib/prisma';
import { createWorkflowContext } from '../lib/pipelines/workflow-engine';

async function main() {
  console.log('--- Verifying Workflow Context Restoration ---');

  // 1. Create a dummy operation with some existing state
  const testId = 'test-checkpoint-' + Date.now();
  const mockSteps = [
    { step: 0, stepName: 'Step 1', status: 'done', extracted_data: { foo: 'bar' } }
  ];

  await prisma.operation.create({
    data: {
      id: testId,
      endpointSlug: 'disbursement',
      pipelineJson: '[]',
      state: 'WAITING_USER_INPUT',
      currentStep: 1,
      stepsResultJson: JSON.stringify(mockSteps),
      totalInputTokens: 500,
      totalOutputTokens: 200,
      totalCostUsd: 0.05
    }
  });

  console.log(`Created mock operation: ${testId}`);

  // 2. Call factory
  const ctx = await createWorkflowContext(testId);

  if (!ctx) {
    console.error('FAILED: Context is null');
    return;
  }

  // 3. Assertions
  console.log('Asserting restored values:');
  console.log(` - currentStep: ${ctx.currentStep} (Expected: 1)`);
  console.log(` - stepsResult length: ${ctx.stepsResult.length} (Expected: 1)`);
  console.log(` - totalInputTokens: ${ctx.totalInputTokens} (Expected: 500)`);
  console.log(` - totalCost: ${ctx.totalCost} (Expected: 0.05)`);

  const success = 
    ctx.currentStep === 1 && 
    ctx.stepsResult.length === 1 && 
    ctx.totalInputTokens === 500 && 
    ctx.totalCost === 0.05;

  if (success) {
    console.log('\n✅ SUCCESS: Context restoration works perfectly.');
  } else {
    console.log('\n❌ FAILED: Values do not match.');
  }

  // Cleanup
  await prisma.operation.delete({ where: { id: testId } });
}

main().catch(console.error);
