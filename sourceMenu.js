const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;

const BoxPointer = imports.ui.boxpointer;
const Slider = imports.ui.slider;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const PortMenu = Me.imports.portMenu;

const VOLUME_NOTIFY_ID = 1;
const PA_MAX = 65536;

const SourceMenu = new Lang.Class({
	Name: 'SourceMenu',
	Extends: PortMenu.PortMenu,

	_init: function(parent, paconn) {
		this.parent(parent, paconn, 'Source');
	},

	_setMuteIcon: function(desc){
		this._icon.icon_name = 'audio-input-microphone-symbolic';
	},

	_isExpandBtnVisible: function(){
		let num = 0;
		for(let d in this._devices){
			num += this._devices[d]._numPorts;
			if(num > 0){
				return true;
			}
		}  

		return false;
	},

	_isVisible: function(){
		return true;
	}

});
