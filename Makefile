#==================================================================
UUID=laine@knasher.gmail.com
FILES=extension.js sinkMenu.js sourceMenu.js streamMenu.js portMenu.js convenience.js prefs.js metadata.json stylesheet.css schemas license
#==================================================================
default_target: all
.PHONY: clean all zip install

clean:
	rm -f $(UUID).zip schemas/gschemas.compiled

all: clean
	@if [ -d schemas ]; then \
		glib-compile-schemas schemas; \
	fi

zip: all
	zip -rq $(UUID).zip $(FILES)

install: all
	cp -R $(FILES) ~/.local/share/gnome-shell/extensions/$(UUID)