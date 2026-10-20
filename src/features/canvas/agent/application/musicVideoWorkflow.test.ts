import { describe, expect, it } from 'vitest';
import {
  partitionMvClipGroups,
} from '../domain/musicVideo';
import {
  createMusicVideoPlan,
  authorMvShotPlan,
  compileMvClipPrompt,
} from './musicVideoWorkflow';

describe('Music Video Workflow Application Service (T14 & A21)', () => {
  describe('Music Duration Authority & Gapless Partitioning (A21)', () => {
    it('partitions a 60-second song into continuous, gapless [4s, 15s] clip groups', () => {
      const groups = partitionMvClipGroups(60.0);
      expect(groups.length).toBeGreaterThanOrEqual(4);

      let totalDuration = 0;
      let expectedStart = 0;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        expect(group.startSeconds).toBe(expectedStart);
        expect(group.durationSeconds).toBeGreaterThanOrEqual(4.0);
        expect(group.durationSeconds).toBeLessThanOrEqual(15.0);
        expect(group.endSeconds).toBe(Math.round((expectedStart + group.durationSeconds) * 1000) / 1000);

        totalDuration += group.durationSeconds;
        expectedStart = group.endSeconds;
      }

      expect(Math.round(totalDuration * 1000) / 1000).toBe(60.0);
    });

    it('rejects master music duration shorter than 4 seconds', () => {
      expect(() => partitionMvClipGroups(2.5)).toThrow('过短');
    });

    it('authorMvShotPlan rejects timeline gaps and duration mismatches', () => {
      const plan = createMusicVideoPlan({
        projectId: 'proj-1',
        prompt: '制作一首 30 秒的完整 MV',
      });

      // Gap between group 1 and group 2 (10s -> 11s)
      const gappedGroups = [
        {
          id: 'g1',
          groupIndex: 0,
          startSeconds: 0,
          endSeconds: 10,
          durationSeconds: 10,
          shots: [{ id: 's1', durationSeconds: 10, shotSize: 'wide', cameraMovement: 'pan', action: 'dance' }],
        },
        {
          id: 'g2',
          groupIndex: 1,
          startSeconds: 11, // GAP of 1 second!
          endSeconds: 20,
          durationSeconds: 9,
          shots: [{ id: 's2', durationSeconds: 9, shotSize: 'close-up', cameraMovement: 'push', action: 'sing' }],
        },
      ];

      expect(() => authorMvShotPlan(plan, 30.0, gappedGroups)).toThrow('存在时间缺口');

      // Duration sum mismatch
      const mismatchGroups = [
        {
          id: 'g1',
          groupIndex: 0,
          startSeconds: 0,
          endSeconds: 10,
          durationSeconds: 10,
          shots: [{ id: 's1', durationSeconds: 10, shotSize: 'wide', cameraMovement: 'pan', action: 'dance' }],
        },
        {
          id: 'g2',
          groupIndex: 1,
          startSeconds: 10,
          endSeconds: 20,
          durationSeconds: 10,
          shots: [{ id: 's2', durationSeconds: 10, shotSize: 'close-up', cameraMovement: 'push', action: 'sing' }],
        },
      ];
      // Total is 20s, but master music is 30s!
      expect(() => authorMvShotPlan(plan, 30.0, mismatchGroups)).toThrow('不一致');
    });
  });

  describe('Concurrency & Prompt Compilation', () => {
    it('locks concurrency limit to 1 for serial visual generation', () => {
      const plan = createMusicVideoPlan({
        projectId: 'proj-1',
        prompt: '做一部国风赛博 MV',
      });

      expect(plan.workflow.id).toBe('mv');
      expect(plan.stages[0].executionLocks.concurrencyLimit).toBe(1);
      const concurrencyDecision = plan.decisions.find((d) => d.key === 'concurrencyLimit');
      expect(concurrencyDecision?.value).toBe(1);
    });

    it('compiles clip prompt with style directives, lip-sync, and character limits', () => {
      const group = {
        id: 'group-1',
        groupIndex: 0,
        startSeconds: 0,
        endSeconds: 12,
        durationSeconds: 12,
        shots: [
          {
            id: 'shot-1',
            durationSeconds: 6,
            shotSize: 'medium',
            cameraMovement: 'orbital spin',
            action: 'Lead singer walks through neon alley in torrential rain',
            lyricsSnippet: 'Lost in the electric dreams',
          },
          {
            id: 'shot-2',
            durationSeconds: 6,
            shotSize: 'close-up',
            cameraMovement: 'fast whip zoom',
            action: 'Cybernetic eye glints with reflected holograms',
          },
        ],
      };

      const prompt = compileMvClipPrompt(group, 'cyberpunk-neon');
      expect(prompt).toContain('Cyberpunk neon aesthetics');
      expect(prompt).toContain('Lost in the electric dreams');
      expect(prompt).toContain('Beat 1 (6s)');
      expect(prompt).toContain('Beat 2 (6s)');
      expect(prompt.length).toBeLessThanOrEqual(7000);
    });
  });
});
