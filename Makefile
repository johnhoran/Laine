#==================================================================
UUID=laine@knasher.gmail.com
FILES=*.js metadata.json stylesheet.css schemas
#==================================================================
default_target: all
.PHONY: clean all zip install

clean:
	rm -f $(UUID).zip src/schemas/gschemas.compiled

all: clean
	@if [ -d src/schemas ]; then \
		glib-compile-schemas src/schemas; \
	fi

zip: all
	cd src ; zip -rq $(UUID).zip $(FILES)
	mv src/$(UUID).zip .
	zip -gq laine@knasher.gmail.com.zip license 

install: all
	cp -R src/$(FILES) ~/.local/share/gnome-shell/extensions/$(UUID)