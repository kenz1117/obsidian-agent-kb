import { Plugin } from 'obsidian';

export default class ObsidianAgentKbPlugin extends Plugin {
  override onload(): void {
    this.addRibbonIcon('database', 'Knowledge Review', () => {
      // Review queue UI is implemented in 0.4.
    });
  }
}
