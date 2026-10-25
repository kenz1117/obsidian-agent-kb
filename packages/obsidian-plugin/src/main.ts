import { Plugin, WorkspaceLeaf } from 'obsidian';

export const REVIEW_VIEW_TYPE = 'oakb-review-view';

export class ReviewView implements WorkspaceLeafContent {
  // Placeholder. Next milestone adds:
  // - auto card queue
  // - governance score
  // - provenance panel
  // - approve/reject/edit actions
}

export default class ObsidianAgentKbPlugin extends Plugin {
  async onload() {
    this.addRibbonIcon('database', 'Knowledge Review', () => {
      // Register view implementation in next milestone.
    });
  }
}
