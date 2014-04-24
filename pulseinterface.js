const Gio = imports.gi.Gio;
const Lang = imports.lang;
const GLib = imports.gi.GLib;


/*
dbus-send --address=unix:path=/run/user/1000/pulse/dbus-socket --print-reply  / org.freedesktop.DBus.Introspectable.Introspect
 socat -v UNIX-LISTEN:/tmp/socat-listen UNIX-CONNECT:/var/run/user/1000/pulse/dbus-socket
*/

function getServerAddress(){
	let ServerLookupProxy = Gio.DBusProxy.makeProxyWrapper('<node>\
		<interface name="org.PulseAudio.ServerLookup1">\
			<property name="Address" type="s" access="read" />\
		</interface>\
	</node>');

	let conn = new ServerLookupProxy(Gio.DBus.session, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
	let address = conn.Address;

	return address;
}

let _paDBusConnection;
function getPADBusConnection(){
	if(_paDBusConnection) return _paDBusConnection;

	let addr = /*this.getServerAddress(); //*/'unix:path=/tmp/socat-listen';
	_paDBusConnection = Gio.DBusConnection.new_for_address_sync(addr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
	return _paDBusConnection;
}


function testIntrospection(){
	let dbus = this.getPADBusConnection();
	let intro = dbus.call_sync(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Introspectable', 'Introspect',
            null, GLib.VariantType.new("(s)"), Gio.DBusCallFlags.NONE, -1,
            null);
	print(intro.deep_unpack());
}

function getPulseAudioConnection(){
	let addr = this.getServerAddress();

	let paProxy = Gio.DBusConnection.new_for_address_sync("unix:path=/run/user/1000/pulse/dbus-socket", Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);

	let introspection = paProxy.call_sync(
            null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Introspectable', 'Introspect',
            null, GLib.VariantType.new("(s)"), Gio.DBusCallFlags.NONE, -1, null);
	
	print(introspection.deep_unpack());
//let conn = new PAProxy(paProxy, 'org.PulseAudio', '/org/pulseaudio/core1');
//	print(conn.Name);

	//let introspect = new IntrospectProxy(paProxy, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
	//print(introspect.IntrospectSync());


}

function getStreams(){
	let dbus = this.getPADBusConnection();
	let response = dbus.call_sync(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
		GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'PlaybackStreams']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

	let streams = response.get_child_value(0).unpack();

	let ans = new Array();
	for(let i = 0; i < streams.n_children(); i++){
		ans[i] = streams.get_child_value(i).get_string()[0];
	}

	return ans;
}


function getPlaybackStreamInformation(target){
	let dbus = this.getPADBusConnection();
	let response = dbus.call_sync(null, target, 'org.freedesktop.DBus.Properties', 'Get',
		GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'PropertyList']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);
	let properties = response.get_child_value(0).unpack();

	var ans = {};
	for(let i = 0; i < properties.n_children(); i++){
		let [index, value] = properties.get_child_value(i).unpack();
		let bytes = new Array();
		for(let j = 0; j < value.n_children(); j++)
			bytes[j] = value.get_child_value(j).get_byte();

		ans[index.get_string()[0]] = String.fromCharCode.apply(String, bytes);
	}
	return ans;
}


function addSignalHandlers(){
	let dbusConn =  this.getPADBusConnection();

	dbusConn.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
		GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewPlaybackStream', []]),  
		null, Gio.DBusCallFlags.NONE, -1, null);

	dbusConn.signal_subscribe(null, 'org.PulseAudio.Core1',
		'NewPlaybackStream',
		'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE,
		_signalReceived, null );

	dbusConn.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
		GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.PlaybackStreamRemoved', []]),  
		null, Gio.DBusCallFlags.NONE, -1, null);

	dbusConn.signal_subscribe(null, 'org.PulseAudio.Core1',
		'PlaybackStreamRemoved',
		'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE,
		_signalReceived, null );

	dbusConn.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Stream.VolumeUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);

}

function getVolumeLevel(target){
	let dbus = this.getPADBusConnection();
	let response = dbus.call_sync(null, target, 'org.freedesktop.DBus.Properties', 'Get',
		GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'Volume']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);
	let volume = response.get_child_value(0).unpack();

	let avg = 0;
	let num = volume.n_children();
	for(let i = 0; i < num; i++)
		avg += volume.get_child_value(i).get_uint32() / num;
	let max = 65536;


	print(avg/max);
	return avg;
}

function isStreamMuted(target){
	let dbus = this.getPADBusConnection();
	let response = dbus.call_sync(null, target, 'org.freedesktop.DBus.Properties', 'Get',
		GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'Mute']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);
	print(response.get_child_value(0).unpack().get_boolean());
}

/*
	conn: dbusconnection
	sender: null: ??
	object: string: /org/pulseaudio/core1
	iface: string: org.PulseAudio.Core1
	signal: string: NewPlaybackStream
	param: variant(o):
	user_data: undefined -- think it is the last option to set when you are subscribing to a signal.

*/
function _signalReceived(conn, sender, object, iface, signal, param, user_data){
	if(signal == 'NewPlaybackStream'){
		let streamPath = param.get_child_value(0).unpack();
		
		print("A: "+streamPath+ " " + isNotable(streamPath));

		let sInfo = getPlaybackStreamInformation(streamPath);
		for(let k in sInfo)
			print("\t"+k+" ::: "+sInfo[k]);

		let vol = getVolumeLevel(streamPath);
		print('Volume:  ' + vol);
	}
	else if(signal == 'PlaybackStreamRemoved'){
		let streamPath = param.get_child_value(0).unpack();
		
		print("R: "+streamPath);

	}
	else
		print("Caught but unhandled: "+signal);
}

function isNotable(path){
	let dbus = this.getPADBusConnection();
	let response = dbus.call_sync(null, path, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'ResampleMethod']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);
	let ans = response.get_child_value(0).unpack().get_string()[0];
	if(ans == "") return false;
	return true;

}

/*
this.addSignalHandlers();

const MainLoop = GLib.MainLoop.new(null, false);
MainLoop.run();

*/

let streams = this.getStreams();
for(let i = 0; i < streams.length; i++){
	print(streams[i]);


	let dbus = this.getPADBusConnection();
	dbus.call_sync(null, streams[i], 'org.freedesktop.DBus.Properties', 'Set',
		GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', 'Mute', GLib.Variant.new_boolean(true)]), null, Gio.DBusCallFlags.NONE, -1, null);

}

