#==================================================================
UUID=laine@knasher.gmail.com
FILES=*.js metadata.json stylesheet.css

#==================================================================

po_files=$(basename $(notdir $(wildcard po/*.po)))

default_target: all
.PHONY: clean all zip install

clean:
	rm -rf bin/ $(UUID).zip

all: clean
	mkdir -p bin
	@if [ -d src/schemas ]; then \
		mkdir -p bin/schemas; \
		glib-compile-schemas --targetdir=bin/schemas src/schemas/; \
	fi

	cp $(FILES:%=src/%) bin/

	@for a in $(po_files); do\
		mkdir -p bin/locale/$$a/LC_MESSAGES/; \
		msgfmt po/$$a.po -o bin/locale/$$a/LC_MESSAGES/$(UUID).mo; \
	done


zip: all
	cd bin ; zip -rq $(UUID).zip *
	mv bin/$(UUID).zip .
	zip -gq laine@knasher.gmail.com.zip license 

install: all
	mkdir -p ~/.local/share/gnome-shell/extensions/$(UUID)
	cp -R bin/* ~/.local/share/gnome-shell/extensions/$(UUID)

#really useful to be able to reload the theme or gnome shell from the cli
reload_theme:
	gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'Main.reloadThemeResource(); Main.loadTheme();'

#not sure what happens if called from wayland though...
restart:
	gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'Meta.restart(_("Restarting"));'

pot:
	xgettext -k_ -kN_ -o po/messages.pot src/*.js
