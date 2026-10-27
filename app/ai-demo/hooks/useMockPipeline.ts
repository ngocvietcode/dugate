// app/ai-demo/hooks/useMockPipeline.ts
// Custom hook: Run mock pipeline with streaming animations.

import { useCallback } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from '../types';
import { deriveLogicalDocs, mockClassifyOutput, mockOcrOutputSingle, mockCrosscheckOutput, mockTotrinhOutput } from '../lib/mock-data';

interface UseMockPipelineOptions {
  files: UploadedFile[];
  setSteps: React.Dispatch<React.SetStateAction<PipelineStep[]>>;
}

export function useMockPipeline({ files, setSteps }: UseMockPipelineOptions) {
  const getStepConfigs = useCallback(() => {
    const logicalDocs = deriveLogicalDocs(files);
    return [
      { isParallel: false, outputFn: () => mockClassifyOutput(files), duration: 2800, streamSpeed: 6 },
      { isParallel: true, items: logicalDocs, getFileOutput: mockOcrOutputSingle, durationBase: 3000, streamSpeed: 10 },
      { isParallel: false, outputFn: () => mockCrosscheckOutput(), duration: 3500, streamSpeed: 5 },
      { isParallel: false, outputFn: () => mockTotrinhOutput(), duration: 5000, streamSpeed: 10 },
    ];
  }, [files]);

  const runSingleStep = useCallback(async (stepIndex: number, config: ReturnType<typeof getStepConfigs>[number]) => {
    const startTime = Date.now();
    setSteps(prev => prev.map((s, idx) => idx === stepIndex ? { ...s, status: 'running' as StepStatus, progress: 0 } : s));

    const duration = config.duration ?? 3000;

    // Animate progress
    await new Promise<void>(resolve => {
      const interval = 50;
      const totalTicks = (duration * 0.7) / interval;
      let tick = 0;
      const timer = setInterval(() => {
        tick++;
        const progress = Math.min(Math.round((tick / totalTicks) * 100), 99);
        setSteps(prev => prev.map((s, i) => i === stepIndex ? { ...s, progress } : s));
        if (tick >= totalTicks) { clearInterval(timer); resolve(); }
      }, interval);
    });

    const output = config.outputFn!();

    // Stream output character by character
    await new Promise<void>(resolve => {
      let charIndex = 0;
      const chunkSize = Math.max(1, Math.floor(output.length / 120));
      const timer = setInterval(() => {
        charIndex = Math.min(charIndex + chunkSize, output.length);
        setSteps(prev => prev.map((s, i) => i === stepIndex ? { ...s, output: output.substring(0, charIndex) } : s));
        if (charIndex >= output.length) { clearInterval(timer); resolve(); }
      }, config.streamSpeed ?? 8);
    });

    const elapsed = Date.now() - startTime;
    setSteps(prev => prev.map((s, idx) =>
      idx === stepIndex ? { ...s, status: 'done' as StepStatus, progress: 100, output, duration: elapsed } : s
    ));
  }, [setSteps]);

  const runParallelStep = useCallback(async (stepIndex: number, config: ReturnType<typeof getStepConfigs>[number]) => {
    const startTimeStep = Date.now();
    const itemsToProcess = config.items || files;
    const durationBase = config.durationBase ?? 3000;

    // Initialize files progress
    setSteps(prev => prev.map((s, idx) => idx === stepIndex ? {
      ...s,
      status: 'running' as StepStatus,
      progress: 0,
      filesProgress: itemsToProcess.map((f) => ({ id: f.id, file: f, status: 'running' as StepStatus, progress: 0, output: null, duration: null })),
    } : s));

    const fileTasksMeta = itemsToProcess.map((file, fileIdx) => {
      const fileDuration = durationBase + Math.random() * 2000;
      return {
        file,
        fileIdx,
        fileDuration,
        output: config.getFileOutput!(file, fileIdx),
        ticksDone: 0,
        totalTicks: Math.floor((fileDuration * 0.7) / 100),
        streamStarted: false,
        charIndex: 0,
        chunkSize: 0,
        streamDone: false,
      };
    });

    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        let allDone = true;
        let anyChanges = false;

        fileTasksMeta.forEach((meta) => {
          if (meta.streamDone) return;
          allDone = false;
          anyChanges = true;

          if (meta.ticksDone < meta.totalTicks) {
            meta.ticksDone++;
          } else {
            if (!meta.streamStarted) {
              meta.streamStarted = true;
              meta.chunkSize = Math.max(1, Math.floor(meta.output.length / 15));
            }
            meta.charIndex += meta.chunkSize;
            if (meta.charIndex >= meta.output.length) {
              meta.charIndex = meta.output.length;
              meta.streamDone = true;
            }
          }
        });

        if (!anyChanges) {
          if (allDone) { clearInterval(timer); resolve(); }
          return;
        }

        setSteps(prev => {
          const newSteps = [...prev];
          const currentStep = { ...newSteps[stepIndex] };
          if (!currentStep.filesProgress) return prev;

          const filesProg = [...currentStep.filesProgress];

          fileTasksMeta.forEach((meta) => {
            const fp = { ...filesProg[meta.fileIdx] };
            if (meta.ticksDone < meta.totalTicks) {
              fp.progress = Math.min(Math.round((meta.ticksDone / meta.totalTicks) * 100), 99);
            } else {
              fp.output = meta.output.substring(0, meta.charIndex);
              if (meta.streamDone) {
                fp.progress = 100;
                fp.status = 'done';
                fp.duration = Date.now() - startTimeStep;
              }
            }
            filesProg[meta.fileIdx] = fp;
          });

          currentStep.filesProgress = filesProg;
          const totalProgress = filesProg.reduce((sum, x) => sum + x.progress, 0);
          currentStep.progress = Math.round(totalProgress / itemsToProcess.length);
          newSteps[stepIndex] = currentStep;
          return newSteps;
        });

        if (allDone) { clearInterval(timer); resolve(); }
      }, 100);
    });

    const elapsedStep = Date.now() - startTimeStep;
    setSteps(prev => prev.map((s, idx) =>
      idx === stepIndex ? { ...s, status: 'done' as StepStatus, progress: 100, duration: elapsedStep } : s
    ));
  }, [files, setSteps]);

  const runFullMockPipeline = useCallback(async () => {
    const configs = getStepConfigs();
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (config.isParallel) {
        await runParallelStep(i, config);
      } else {
        await runSingleStep(i, config);
      }
    }
  }, [getStepConfigs, runSingleStep, runParallelStep]);

  const retryMockStep = useCallback(async (stepIndex: number) => {
    setSteps(prev => prev.map((s, idx) =>
      idx === stepIndex ? { ...s, status: 'pending' as StepStatus, progress: 0, output: null, duration: null, filesProgress: [], isCollapsed: false } : s
    ));
    await new Promise(r => setTimeout(r, 400));

    const config = getStepConfigs()[stepIndex];
    if (config.isParallel) {
      await runParallelStep(stepIndex, config);
    } else {
      await runSingleStep(stepIndex, config);
    }
  }, [getStepConfigs, runSingleStep, runParallelStep, setSteps]);

  return { runFullMockPipeline, retryMockStep };
}
