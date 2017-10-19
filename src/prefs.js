const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const KEY_PA_OVER = "volume-overdrive";
const KEY_PORT_LABEL = "show-port-label";
const KEY_MERGE_CONTROLS = "merge-controls";
const KEY_OPEN_SETTINGS = "open-settings";
const KEY_ICON_POSITION = "icon-position";

function init(){
	Convenience.initTranslations();
}

const LainePrefsWidget = new GObject.Class({
	Name: "Laine.Prefs.Widget",
	GTypeName: "LainePrefsWidget",
	Extends: Gtk.Grid,

	_init:function(params){
		this.parent(params);
		this.margin = this.row_spacing = this.column_spacing = 10;
		this.set_hexpand(true);

		this._settings = Convenience.getSettings();
		//-----------------------------------------------------------
		//Labels
		let lbl_volumeOverdrive = new Gtk.Label({
			label: _("Volume overdrive"),
			halign: Gtk.Align.END}
		);
		let lbl_showPortLabel = new Gtk.Label({
			label: _("Show active port label"),
			halign: Gtk.Align.END
		});
		let lbl_mergeAggregate = new Gtk.Label({
			label: _("Merge controls into aggregate menu"),
			halign: Gtk.Align.END
		});
		let lbl_openSettings = new Gtk.Label({
			label: _("Add menu entry for configuration tool"),
			halign: Gtk.Align.END
		});
		let lbl_appSettings = new Gtk.Label({
			label: _("Configuration tool to open"),
			halign: Gtk.Align.END
		});

		let lbl_iconRightPosition = new Gtk.Label({
			label: _("Insert icon next to aggregate menu"),
			halign: Gtk.Align.END
		});

		this.attach(lbl_volumeOverdrive, 0, 0, 1, 1);
		this.attach_next_to(lbl_showPortLabel, lbl_volumeOverdrive,
			Gtk.PositionType.BOTTOM, 1, 1);
		this.attach_next_to(lbl_mergeAggregate, lbl_showPortLabel,
			Gtk.PositionType.BOTTOM, 1, 1);
		this.attach_next_to(lbl_iconRightPosition, lbl_mergeAggregate,
			Gtk.PositionType.BOTTOM, 1, 1);
		this.attach_next_to(lbl_openSettings, lbl_iconRightPosition,
			Gtk.PositionType.BOTTOM, 1, 1);
		this.attach_next_to(lbl_appSettings, lbl_openSettings,
			Gtk.PositionType.BOTTOM, 1, 1);

		//-----------------------------------------------------------
		//Controls


		let volumeOverdrive = Gtk.Scale.new_with_range(
			Gtk.Orientation.HORIZONTAL, 80, 150, 5);
		volumeOverdrive.set_value(this._settings.get_int(KEY_PA_OVER));

		this._showLabelSwitch = new Gtk.Switch({
			active: this._settings.get_boolean(KEY_PORT_LABEL)
		});
		this._mergeAggregateSwitch = new Gtk.Switch({
			active: this._settings.get_boolean(KEY_MERGE_CONTROLS)
		});
		this._iconRightPositionSwitch = new Gtk.Switch({
			active: this._settings.get_boolean(KEY_ICON_POSITION),
			sensitive: !this._settings.get_boolean(KEY_MERGE_CONTROLS)
		});
		this._openSettingsSwitch = new Gtk.Switch({
			active: this._settings.get_boolean(KEY_OPEN_SETTINGS)
		});

        //this._appSettingsChooser = new Gtk.AppChooserWidget({ show_all: true });
        //this._appSettingsChooser.connect('application-selected', function(entry) {
            //this._settings.set_string('app-settings', get_app_info());
        //});
        
		this._appSettingsEntry =  new Gtk.Entry();
        //this._appSettingsEntry.set_placeholder_text(_("PulseAudio configuration tool"));
        this._appSettingsEntry.set_text(this._settings.get_string('app-settings'));
        let completion =  new Gtk.EntryCompletion();
        this._appSettingsEntry.set_completion(completion);
        completion.set_model(this._getDesktopFilesList());
        completion.set_text_column(0)

        this._appSettingsEntry.connect('notify::text', function(entry) {
            this._settings.set_string('app-settings', entry.text.trim());
        });


		volumeOverdrive.connect('value-changed', Lang.bind(this,
			function(src){ this._settings.set_int(KEY_PA_OVER, src.get_value()); }
		));
		this._showLabelSwitch.connect('notify::active', Lang.bind(this,
			function(src){ this._settings.set_boolean(KEY_PORT_LABEL, src.active); }
        ));
        this._mergeAggregateSwitch.connect('notify::active', Lang.bind(this,
			function(src){this._settings.set_boolean(KEY_MERGE_CONTROLS, src.active);}
		));
		this._mergeAggregateSwitch.connect('notify::active', Lang.bind(this,
			function(src, a, b){
				this._iconRightPositionSwitch
					.set_sensitive(! this._mergeAggregateSwitch.get_active()); }
		));
		this._iconRightPositionSwitch.connect('notify::active', Lang.bind(this,
			function(src){this._settings.set_boolean(KEY_ICON_POSITION, src.active);}
		));
		this._openSettingsSwitch.connect('notify::active', Lang.bind(this,
			function(src){this._settings.set_boolean(KEY_OPEN_SETTINGS, src.active);}
		));


		this.attach_next_to(volumeOverdrive, lbl_volumeOverdrive,
			Gtk.PositionType.RIGHT, 2, 1);
		this.attach_next_to(this._showLabelSwitch, lbl_showPortLabel,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._mergeAggregateSwitch, lbl_mergeAggregate,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._iconRightPositionSwitch, lbl_iconRightPosition,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._openSettingsSwitch, lbl_openSettings,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._appSettingsEntry, lbl_appSettings,
			Gtk.PositionType.RIGHT, 1, 1);
		volumeOverdrive.set_hexpand(true);
		volumeOverdrive.add_mark(100, Gtk.PositionType.BOTTOM, null);

		//Just for spacing to expand column three
		this.attach_next_to(new Gtk.Label({
			visible:false,
			hexpand:true
		}),this._showLabelSwitch, Gtk.PositionType.RIGHT, 1, 1);

	},

    _getDesktopFilesList: function() {
        let sListStore = new Gtk.ListStore();
        sListStore.set_column_types([GObject.TYPE_STRING]);
        let [_, out, err, stat] = GLib.spawn_command_line_sync('sh -c "for app in /usr/share/applications/*.desktop ~/.local/share/applications/*.desktop; do app=\"${app##*/}\"; echo \"${app%.desktop}\"; done"');
        
        let sList = out.toString().split("\n");
        sList = sList.sort(
            function (a, b) {
                return a.toLowerCase().localeCompare(b.toLowerCase());
            })
        for (let i in sList) {
            sListStore.set(sListStore.append(), [0], [sList[i]]);
        }
        return sListStore;
    }
});


function buildPrefsWidget() {
	let widget = new LainePrefsWidget();
	widget.show_all();

	return widget;
}
