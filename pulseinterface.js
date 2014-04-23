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

	let addr = this.getServerAddress(); //'unix:path=/tmp/socat-listen';//
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

function _signalReceived(conn, sender, object, iface, signal, param, user_data){
	print("here"); 
}

let dbusConn = this.getPADBusConnection();
dbusConn.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
	//null,
	GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewPlaybackStream', []]),  
	null, Gio.DBusCallFlags.NONE, -1, null);

dbusConn.signal_subscribe(
		null,
		'org.PulseAudio.Core1',
		'NewPlaybackStream',
		'/org/pulseaudio/core1',
		null,
		Gio.DBusSignalFlags.NONE,
		_signalReceived,
		null
	);

const MainLoop = GLib.MainLoop.new(null, false);
MainLoop.run();