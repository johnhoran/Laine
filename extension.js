const Lang = imports.lang;
const St = imports.gi.St;
const Gvc = imports.gi.Gvc;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const GLib = imports.gi.GLib;

let _mixerControl;
function getMixerControl(){
  if(_mixerControl) return _mixerControl;

  _mixerControl = new Gvc.MixerControl({ name: 'Laine Volume Control' });
  _mixerControl.open();
  return _mixerControl;
}

const Laine = new Lang.Class({
  Name: 'Laine',
  Extends: PanelMenu.Button,

  _init: function(){
    this.parent(0.0);

    this._mixerControl = getMixerControl();
    this._icon = new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon' });
    this._mainMenu = new MainMenu(this._mixerControl);

    let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
    hbox.add_child(this._icon);


    this.actor.add_child(hbox);
    this.menu.addMenuItem(this._mainMenu);

    return 0;
  }
});

const MainMenu = new Lang.Class({
  Name: 'VolumeMenu',
  Extends: PopupMenu.PopupMenuSection,

  _init: function(control) {
    this.parent();

    let sourceMenu = new SourceMenu(control);
    this.addMenuItem(sourceMenu);
  }
});

const SourceMenu = new Lang.Class({
  Name: 'SourceMenu',
  Extends: PopupMenu.PopupMenuSection,

  _init: function(control) {
    this.parent();
    this._sources = {};

    let test = new PopupMenu.PopupMenuItem(_("TEST"));

    this.addMenuItem(test);
    control.connect('stream_added', Lang.bind(this, this._addSource));
    control.connect('stream_removed', Lang.bind(this, this._removeSource));

  },

  _addSource: function(control, src){
    let stream = control.lookup_stream_id(src);
    if(stream instanceof Gvc.MixerSinkInput){
      let newEntry = new SourceApplication(stream);
      this.addMenuItem(newEntry);
      this._sources[src] = newEntry;
    }
  },

  _removeSource: function(control, src){
    if(src in this._sources){
      this._sources[src].destroy();
      delete this._sources[src];
    }
  }
});

const SourceApplication = new Lang.Class({
  Name: 'SourceApplication',
  Extends: PopupMenu.PopupMenuSection,

  _init: function(src){
    this.parent();

    let icon = new St.Icon();
    icon.set_gicon(src.get_gicon());
    this.actor.add(icon);
    this.addMenuItem(new PopupMenu.PopupMenuItem(_(src.get_name())));

    this.processID = getProcessID(src.index);
    log("TEST "+this.processID);
  },

  getProcessID: function(index) {
    let paInfo = GLib.spawn_command_line_sync("pactl list sink-inputs", null, null, null)[1].toString();
    let paStreams = paInfo.split("Sink Input #");
    let idStr = index.toString();
    paInfo = "";

    for(let i = 0; i < paStreams.length; i++){
      let start = paStreams[i].substr(0, idStr.length);
      if(idStr == start){
        paInfo = paStreams[i];
        break;
      }
    }

    let procID = -1;
    if(paInfo != ""){
      let patt = new RegExp("application.process.id = \"(\\d*)\"");
      procID = patt.exec(paInfo)[1];
    }

    return procID;
  }

  
});

let _menuButton;

function init(){}

function enable(){
  _menuButton = new Laine();
  Main.panel.addToStatusArea('laine', _menuButton);
}

function disable(){
  _menuButton.destroy();
}