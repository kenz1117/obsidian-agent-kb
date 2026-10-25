import { Plugin } from 'obsidian';
export default class ObsidianAgentKbPlugin extends Plugin {
    onload() {
        this.addRibbonIcon('database', 'Knowledge Review', () => {
            // Review queue UI is implemented in 0.4.
        });
    }
}
//# sourceMappingURL=main.js.map