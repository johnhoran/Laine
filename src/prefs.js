const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const KEY_PA_OVER = "volume-overdrive";
const KEY_PORT_LABEL = "show-port-label";
const KEY_MERGE_CONTROLS = "merge-controls";
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

		this.attach_next_to(volumeOverdrive, lbl_volumeOverdrive,
			Gtk.PositionType.RIGHT, 2, 1);
		this.attach_next_to(this._showLabelSwitch, lbl_showPortLabel,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._mergeAggregateSwitch, lbl_mergeAggregate,
			Gtk.PositionType.RIGHT, 1, 1);
		this.attach_next_to(this._iconRightPositionSwitch, lbl_iconRightPosition,
			Gtk.PositionType.RIGHT, 1, 1);
		volumeOverdrive.set_hexpand(true);
		volumeOverdrive.add_mark(100, Gtk.PositionType.BOTTOM, null);

		//Just for spacing to expand column three
		this.attach_next_to(new Gtk.Label({
			visible:false,
			hexpand:true
		}),this._showLabelSwitch, Gtk.PositionType.RIGHT, 1, 1);

	}
});

function buildPrefsWidget() {
	let widget = new LainePrefsWidget();
	widget.show_all();

	return widget;
}
