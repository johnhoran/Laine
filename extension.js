const Lang = imports.lang;
const St = imports.gi.St;
const Gvc = imports.gi.Gvc;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;

const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const GLib = imports.gi.GLib;
const Shell = imports.gi.Shell;

const DECIBEL_UPDATE_INTERVAL = 1000;

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
    control.get_pa_context(control);
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
    this._source = src;

    let icon = new St.Icon();
    icon.set_gicon(src.get_gicon());
    let switchBtn = new St.Button({child: icon});
    switchBtn.connect('clicked', Lang.bind(this, this.switchToApp));
    this.actor.add(switchBtn);

    this.addMenuItem(new PopupMenu.PopupMenuItem(_(src.get_name())));

    this.processID = this._getProcessID(src.index);
   // this._timeout = Mainloop.timeout_add(DECIBEL_UPDATE_INTERVAL, Lang.bind(this, this._updateDecibelMeter));

  },

  destroy: function(){
    Mainloop.source_remove(this._timeout);
    this.actor.destroy();
  },

  _getProcessID: function(index) {
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
  },

  switchToApp: function(){
    let windowTracker = Shell.WindowTracker.get_default();
    let app = windowTracker.get_app_from_pid(this.processID);

    if(app == null){
      //Doesn't have an open window, lets check the tray.
      let trayNotifications = Main.messageTray.getSources();
      for(let i = 0; i < trayNotifications.length; i++)
        if(trayNotifications[i].pid == this.processID)
          app = trayNotifications[i].app;
    }

    if(app == null){
      //Well isn't this annoying, maybe just launch the application again?
      //TODO: Figure this out later.
    }

    if(app != null){
      app.activate();

    }
  },

  _updateDecibelMeter: function(){
    log(this.processID+" tick " +this._source.get_channel_map().get_volume());
    return true;
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