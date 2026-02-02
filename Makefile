.PHONY: build install clean

build:
	python3 -m py_compile streamer.py
	@echo "✅ Build complete (syntax check passed)."

install:
	pip3 install -e .
	@echo "✅ Installed. Use 'music-streamer' command to run."

clean:
	rm -rf build/ dist/ *.egg-info __pycache__
	@echo "✅ Cleaned."
