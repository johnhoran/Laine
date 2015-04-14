const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;

const BoxPointer = imports.ui.boxpointer;
const Slider = imports.ui.slider;
const Signals = imports.signals;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const PortMenu = Me.imports.portMenu;

const SinkMenu = new Lang.Class({
	Name: 'SinkMenu',
	Extends: PortMenu.PortMenu,

	_init:function(parent, paconn){
		this.parent(parent, paconn, 'Sink');
	},

	_setMuteIcon: function(desc){
		if(desc.endsWith("headphones"))
			this._icon.icon_name = 'audio-headphones-symbolic';
		else if(desc.startsWith("hdmi") || desc.startsWith("iec958"))
			this._icon.icon_name = 'audio-card-symbolic';
		else
			this._icon.icon_name = 'audio-speakers-symbolic';
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