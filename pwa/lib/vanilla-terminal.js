class VanillaTerminal {
    constructor(opts = {}) {
        this.opts = opts;
        this.container = typeof opts.container === 'string' ?
            document.querySelector(opts.container) : opts.container;
        this.welcome = opts.welcome || 'Welcome to Terminal';
        this.prompt = opts.prompt || '> ';
        this.commands = {}; // registry
        this.onInputCallback = opts.onInput;

        this.init();
    }

    init() {
        this.container.classList.add('vanilla-terminal');
        this.container.innerHTML = `
            <div class="vanilla-terminal-output"></div>
            <div class="vanilla-terminal-line">
                <span class="vanilla-terminal-prompt">${this.prompt}</span>
                <input type="text" class="vanilla-terminal-input" autofocus>
            </div>
        `;

        this.outputNode = this.container.querySelector('.vanilla-terminal-output');
        this.inputNode = this.container.querySelector('.vanilla-terminal-input');

        this.print(this.welcome);

        this.inputNode.addEventListener('keydown', (e) => {
            if (this.opts.onKeyDown) {
                this.opts.onKeyDown(e);
            }

            if (e.key === 'Enter') {
                const value = this.inputNode.value.trim();
                const displayValue = this.inputNode.value; // Keep original for display
                this.inputNode.value = '';
                // Only print if there was actual input or if we want to show empty lines
                if (displayValue || value) {
                    this.print(`${this.prompt}${displayValue}`);
                }
                if (value) this.handleInput(value);
            }

            // Prevent some defaults if we are in TUI mode (handled by app)
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape'].includes(e.key)) {
                // We don't preventDefault here yet to allow app to decide, 
                // but we need to ensure the app gets them.
            }
        });

        this.container.addEventListener('click', () => this.inputNode.focus());
    }

    print(text) {
        const line = document.createElement('div');
        line.innerHTML = text;
        this.outputNode.appendChild(line);
        this.container.scrollTop = this.container.scrollHeight;
    }

    clear() {
        this.outputNode.innerHTML = '';
    }

    setPrompt(p) {
        this.prompt = p;
        const promptNode = this.container.querySelector('.vanilla-terminal-prompt');
        if (promptNode) promptNode.textContent = p;
    }

    handleInput(cmd) {
        if (this.onInputCallback) {
            this.onInputCallback(cmd);
        }
    }
}
