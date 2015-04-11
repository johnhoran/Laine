const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const KEY_PA_OVER = "volume-overdrive";
const KEY_PORT_LABEL = "show-port-label";

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

		this._settings = Convenience.getSettings();
		//-----------------------------------------------------------
		let volumeOverdrive = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 80, 150, 5);
		volumeOverdrive.set_value(this._settings.get_int(KEY_PA_OVER));
		volumeOverdrive.connect('value-changed', Lang.bind(this, function(src){
			this._settings.set_int(KEY_PA_OVER, src.get_value());
		}));

		this.attach(new Gtk.Label({
			label: _("Volume overdrive"),
			halign: Gtk.Align.START
		}), 0, 0, 1, 1);

		this.attach(volumeOverdrive, 20, 0, 40, 1);

		//-----------------------------------------------------------

		let showLabelsSwitch = Gtk.Switch.new();
		showLabelsSwitch.connect('state-set', Lang.bind(this, function(src){
				this._setPortLabelVisibility(src.get_state());

		}));
		showLabelsSwitch.set_state(this._settings.get_boolean(KEY_PORT_LABEL));

		this.attach(new Gtk.Label({
			label: _("Show active port label"),
			halign: Gtk.Align.START
		}), 0, 1, 1, 1);
		this.attach(showLabelsSwitch, 20, 1, 1, 1);

		//-----------------------------------------------------------

	},

	_setPortLabelVisibility:function(visible){
				this._settings.set_boolean(KEY_PORT_LABEL, visible);
				log("setVisibl");
	}
});

function buildPrefsWidget() {
	let widget = new LainePrefsWidget();
	widget.show_all();

	return widget;
}