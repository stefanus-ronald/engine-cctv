#!/usr/bin/env node
/**
 * test-onvif.js — unit tests for the pure ONVIF logic (V-014, Fase 1).
 *
 * Covers what is verifiable WITHOUT real hardware: WS-Security digest math, SOAP
 * envelope/fault handling, WS-Discovery probe + ProbeMatch parse, Media profile +
 * stream-URI parse, and credential injection. Network round-trips to a real
 * ONVIF camera still require on-site validation (see V-014 §10/§11).
 *
 * Run: node scripts/test-onvif.js   (exit 0 = all pass)
 */

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}
function eq(name, got, want) {
  const c = got === want;
  if (!c) console.log(`    got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok(name, c);
}

console.log('ws-security');
{
  const ws = require('../src/onvif/ws-security');
  // Pinned vector (computed independently): SHA1(nonce16 + created + password) b64.
  const nonce = Buffer.from('0123456789abcdef', 'utf8');
  const digest = ws.passwordDigest(nonce, '2026-06-30T10:00:00Z', 'test');
  eq('passwordDigest matches reference vector', digest, 'lylhQYVA7Ss1ujUHHa5pw105Ocs=');
  const hdr = ws.buildSecurityHeader('admin', 'test', { nonceBytes: nonce, created: '2026-06-30T10:00:00Z' });
  ok('header has UsernameToken', /<wsse:UsernameToken>/.test(hdr));
  ok('header embeds username', /<wsse:Username>admin<\/wsse:Username>/.test(hdr));
  ok('header embeds the digest', hdr.includes('lylhQYVA7Ss1ujUHHa5pw105Ocs='));
  ok('header embeds nonce (b64)', hdr.includes('MDEyMzQ1Njc4OWFiY2RlZg=='));
  eq('escapeXml escapes &<>', ws.escapeXml('a&b<c>d'), 'a&amp;b&lt;c&gt;d');
}

console.log('soap-client');
{
  const soap = require('../src/onvif/soap-client');
  const env = soap.buildEnvelope('<tds:GetDeviceInformation/>', '<sec/>');
  ok('envelope wraps body', /<env:Body><tds:GetDeviceInformation\/><\/env:Body>/.test(env));
  ok('envelope includes header', env.includes('<env:Header><sec/></env:Header>'));
  ok('envelope declares soap 1.2 ns', env.includes('http://www.w3.org/2003/05/soap-envelope'));
  const fault = soap.extractFault('<env:Body><env:Fault><env:Reason><env:Text xml:lang="en">Sender not authorized</env:Text></env:Reason></env:Fault></env:Body>');
  eq('extractFault reads reason text', fault, 'Sender not authorized');
  eq('extractFault null when no fault', soap.extractFault('<env:Body><ok/></env:Body>'), null);
}

console.log('ws-discovery');
{
  const wsd = require('../src/onvif/ws-discovery');
  const probe = wsd.buildProbe('11111111-2222-3333-4444-555555555555');
  ok('probe targets discovery Action', probe.includes('/ws/2005/04/discovery/Probe'));
  ok('probe asks for NetworkVideoTransmitter', probe.includes('NetworkVideoTransmitter'));
  const sampleMatch =
    '<e:Envelope><e:Body><d:ProbeMatches><d:ProbeMatch>' +
    '<d:Scopes>onvif://www.onvif.org/name/Acme%20Cam onvif://www.onvif.org/hardware/IPC-1234 onvif://www.onvif.org/location/Lobby</d:Scopes>' +
    '<d:XAddrs>http://192.168.1.50/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs>' +
    '</d:ProbeMatch></d:ProbeMatches></e:Body></e:Envelope>';
  const m = wsd.parseProbeMatch(sampleMatch);
  eq('parse picks http XAddr', m.xaddr, 'http://192.168.1.50/onvif/device_service');
  eq('parse extracts ip', m.ip, '192.168.1.50');
  eq('parse decodes name scope', m.name, 'Acme Cam');
  eq('parse reads hardware scope', m.hardware, 'IPC-1234');
  eq('parse reads location scope', m.location, 'Lobby');
}

console.log('media');
{
  const media = require('../src/onvif/media');
  const profilesXml =
    '<trt:GetProfilesResponse>' +
    '<trt:Profiles token="Profile_1"><tt:Name>mainStream</tt:Name>' +
      '<tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding>' +
      '<tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>' +
      '</tt:VideoEncoderConfiguration></trt:Profiles>' +
    '<trt:Profiles token="Profile_2"><tt:Name>subStream</tt:Name>' +
      '<tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding>' +
      '<tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution>' +
      '</tt:VideoEncoderConfiguration></trt:Profiles>' +
    '</trt:GetProfilesResponse>';
  const profs = media.parseProfiles(profilesXml);
  eq('parsed 2 profiles', profs.length, 2);
  eq('profile 1 token', profs[0].token, 'Profile_1');
  eq('profile 1 name', profs[0].name, 'mainStream');
  eq('profile 1 width', profs[0].width, 1920);
  eq('profile 2 token', profs[1].token, 'Profile_2');
  eq('deviceXAddr convention', media.deviceXAddr('10.0.0.7', 8000), 'http://10.0.0.7:8000/onvif/device_service');
}

console.log('camera-manager (onvif URL + credential injection)');
{
  const cm = require('../src/camera-manager');
  // credential-free ONVIF URI → creds injected
  const onv = { id: 'o1', protocol: 'onvif', username: 'admin', password: 'p@ss/1',
    onvif: { streamUri: 'rtsp://10.0.0.9:554/Streaming/101', streamUriSub: 'rtsp://10.0.0.9:554/Streaming/102' } };
  eq('onvif main: creds injected (url-encoded)', cm.buildRtspUrlForQuality(onv, 'main'),
    'rtsp://admin:p%40ss%2F1@10.0.0.9:554/Streaming/101');
  eq('onvif sub: uses sub uri', cm.buildRtspUrlForQuality(onv, 'sub'),
    'rtsp://admin:p%40ss%2F1@10.0.0.9:554/Streaming/102');
  // URI that already carries creds → left untouched
  const onv2 = { id: 'o2', protocol: 'onvif', username: 'x', password: 'y',
    onvif: { streamUri: 'rtsp://u:v@10.0.0.9:554/s1' } };
  eq('onvif keeps existing creds', cm.buildRtspUrlForQuality(onv2, 'main'), 'rtsp://u:v@10.0.0.9:554/s1');
  // ISAPI camera unaffected (regression guard for Fase 0)
  const hik = { id: 'h1', ip: '10.0.0.5', port: 554, rtspPath: '/Streaming/Channels/101', username: 'admin', password: 'x' };
  eq('isapi main unchanged', cm.buildRtspUrlForQuality(hik, 'main'), 'rtsp://admin:x@10.0.0.5:554/Streaming/Channels/101');
  eq('isapi sub unchanged', cm.buildRtspUrlForQuality(hik, 'sub'), 'rtsp://admin:x@10.0.0.5:554/Streaming/Channels/102');
}

console.log('driver resolution');
{
  const dd = require('../src/drivers/device-driver');
  eq('onvif protocol resolves', dd.getProtocol({ protocol: 'onvif' }), 'onvif');
  eq('onvif driver name', dd.getDriver({ protocol: 'onvif' }).name, 'onvif');
  eq('default driver name', dd.getDriver({}).name, 'isapi');
}

console.log('events (Fase 2 — PullPoint)');
{
  const soap = require('../src/onvif/soap-client');
  const ev = require('../src/onvif/events');
  const hdr = soap.wsaHeaders('http://act/PullMessages', 'http://192.168.1.5/onvif/Sub?token=1');
  ok('wsaHeaders has Action', hdr.includes('<wsa:Action') && hdr.includes('PullMessages'));
  ok('wsaHeaders has To', hdr.includes('<wsa:To') && hdr.includes('/onvif/Sub'));

  const createResp =
    '<tev:CreatePullPointSubscriptionResponse>' +
    '<tev:SubscriptionReference><wsa:Address>http://192.168.1.5/onvif/Subscription?idx=9</wsa:Address></tev:SubscriptionReference>' +
    '</tev:CreatePullPointSubscriptionResponse>';
  eq('extractSubscriptionAddress', ev.extractSubscriptionAddress(createResp), 'http://192.168.1.5/onvif/Subscription?idx=9');

  const pullResp =
    '<tev:PullMessagesResponse>' +
    '<wsnt:NotificationMessage><wsnt:Topic Dialect="x">tns1:RuleEngine/CellMotionDetector/Motion</wsnt:Topic>' +
      '<wsnt:Message><tt:Message UtcTime="2026-07-01T04:00:00Z"><tt:Data>' +
      '<tt:SimpleItem Name="IsMotion" Value="true"/></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>' +
    '<wsnt:NotificationMessage><wsnt:Topic>tns1:RuleEngine/LineDetector/Crossed</wsnt:Topic>' +
      '<wsnt:Message><tt:Message UtcTime="2026-07-01T04:00:05Z"><tt:Data>' +
      '<tt:SimpleItem Name="Crossed" Value="false"/></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>' +
    '</tev:PullMessagesResponse>';
  const notes = ev.parseNotifications(pullResp);
  eq('parsed 2 notifications', notes.length, 2);
  eq('note 1 topic', notes[0].topic, 'tns1:RuleEngine/CellMotionDetector/Motion');
  eq('note 1 active (Value=true)', notes[0].active, true);
  eq('note 1 utcTime', notes[0].utcTime, '2026-07-01T04:00:00Z');
  eq('note 2 inactive (Value=false)', notes[1].active, false);
  eq('isActive default true when no SimpleItem', ev.isActive('<x>changed</x>'), true);
  eq('isActive false on Deleted op', ev.isActive('<x PropertyOperation="Deleted"/>'), false);
}

console.log('normalizeOnvifEvent (Fase 2)');
{
  const { normalizeOnvifEvent } = require('../src/events/event-normalizer');
  const mk = (topic, active) => normalizeOnvifEvent({ topic, active, utcTime: '2026-07-01T04:00:00Z' }, 'cam-1');
  eq('motion → motion', mk('tns1:RuleEngine/CellMotionDetector/Motion', true).detectorId, 'motion');
  eq('MotionAlarm → motion', mk('tns1:VideoSource/MotionAlarm', true).detectorId, 'motion');
  eq('LineDetector → line', mk('tns1:RuleEngine/LineDetector/Crossed', true).detectorId, 'line');
  eq('FieldDetector → loitering', mk('tns1:RuleEngine/FieldDetector/ObjectsInside', true).detectorId, 'loitering');
  eq('FaceDetector → face', mk('tns1:RuleEngine/FaceDetector/Face', true).detectorId, 'face');
  ok('inactive → null', mk('tns1:RuleEngine/CellMotionDetector/Motion', false) === null);
  ok('tamper/system topic → null', mk('tns1:Device/HardwareFailure/TamperDetector', true) === null);
  const e = mk('tns1:RuleEngine/CellMotionDetector/Motion', true);
  eq('ts parsed from utcTime', e.ts, new Date('2026-07-01T04:00:00Z').getTime());
  eq('source is edge', e.source, 'edge');
  eq('type is detection', e.type, 'detection');
}

console.log('ptz (Fase 3)');
{
  const ptz = require('../src/onvif/ptz');
  eq('clamp caps at 1', ptz._clamp(5), 1);
  eq('clamp floors at -1', ptz._clamp(-9), -1);
  eq('clamp NaN → 0', ptz._clamp('x'), 0);
  const move = ptz.buildMoveBody('Profile_1', { pan: 0.6, tilt: -0.6, zoom: 2 });
  ok('move body has ProfileToken', move.includes('<tptz:ProfileToken>Profile_1</tptz:ProfileToken>'));
  ok('move body PanTilt x/y', move.includes('<tt:PanTilt x="0.6" y="-0.6"/>'));
  ok('move body zoom clamped to 1', move.includes('<tt:Zoom x="1"/>'));
  const stop = ptz.buildStopBody('Profile_1');
  ok('stop body stops PanTilt+Zoom', stop.includes('<tptz:PanTilt>true</tptz:PanTilt>') && stop.includes('<tptz:Zoom>true</tptz:Zoom>'));
  const drv = require('../src/drivers/onvif-driver');
  eq('driver exposes ptz fn', typeof drv.ptz, 'function');
}

console.log('replay (Fase 4 — Profile G)');
{
  const rp = require('../src/onvif/replay');
  const findResp =
    '<tse:FindRecordingsResponse><tse:SearchToken>Search_1</tse:SearchToken></tse:FindRecordingsResponse>';
  eq('no tokens in bare FindRecordings', rp.parseRecordingTokens(findResp).length, 0);
  const resultsResp =
    '<tse:GetRecordingSearchResultsResponse><tt:RecordingInformation>' +
    '<tt:RecordingToken>SD_REC1</tt:RecordingToken></tt:RecordingInformation>' +
    '<tt:RecordingInformation><tt:RecordingToken>SD_REC2</tt:RecordingToken></tt:RecordingInformation>' +
    '</tse:GetRecordingSearchResultsResponse>';
  const toks = rp.parseRecordingTokens(resultsResp);
  eq('parsed 2 recording tokens', toks.length, 2);
  eq('token 1', toks[0], 'SD_REC1');
  eq('token 2', toks[1], 'SD_REC2');
  const drv = require('../src/drivers/onvif-driver');
  eq('driver exposes searchRecordings', typeof drv.searchRecordings, 'function');
  eq('driver exposes getReplayUri', typeof drv.getReplayUri, 'function');
  const ps = require('../src/webrtc/playback-stream');
  eq('playback-stream exposes startPlaybackFromUrl', typeof ps.startPlaybackFromUrl, 'function');
}

console.log('capabilities (Fase 5)');
{
  const caps = require('../src/onvif/capabilities');
  // detectorsFromTopics maps a TopicSet blob to detector flags.
  const topics = 'tns1:RuleEngine/CellMotionDetector/Motion tns1:RuleEngine/LineDetector/Crossed ' +
    'tns1:RuleEngine/FieldDetector/ObjectsInside';
  const d = caps.detectorsFromTopics(topics);
  eq('topics → motion', d.motion, true);
  eq('topics → line', d.line, true);
  eq('topics → loitering', d.loitering, true);
  eq('topics → face (absent)', d.face, false);
  const none = caps.detectorsFromTopics('tns1:Device/HardwareFailure/StorageFailure');
  eq('non-detector topic → motion false', none.motion, false);
  const drv = require('../src/drivers/onvif-driver');
  eq('driver getCapabilities is fn', typeof drv.getCapabilities, 'function');
}

console.log('onvif-event-manager loads + getStatus');
{
  const mgr = require('../src/onvif/onvif-event-manager');
  ok('exports init/stop/getStatus', typeof mgr.init === 'function' && typeof mgr.stop === 'function' && Array.isArray(mgr.getStatus()));
}

console.log('hardening pasca-review (2026-07-02)');
{
  const soap = require('../src/onvif/soap-client');
  // parseSystemDateAndTime: UTCDateTime → epoch ms (clock-offset learning).
  const sdtXml =
    '<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime>' +
    '<tt:UTCDateTime><tt:Time><tt:Hour>10</tt:Hour><tt:Minute>30</tt:Minute><tt:Second>15</tt:Second></tt:Time>' +
    '<tt:Date><tt:Year>2026</tt:Year><tt:Month>7</tt:Month><tt:Day>2</tt:Day></tt:Date></tt:UTCDateTime>' +
    '</tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>';
  eq('parseSystemDateAndTime → epoch', soap.parseSystemDateAndTime(sdtXml), Date.UTC(2026, 6, 2, 10, 30, 15));
  eq('parseSystemDateAndTime null on junk', soap.parseSystemDateAndTime('<nope/>'), null);
  eq('parseSystemDateAndTime null on empty', soap.parseSystemDateAndTime(''), null);

  // buildSecurityHeader honours clockOffsetMs (Created shifts into device time).
  const ws = require('../src/onvif/ws-security');
  const h1 = ws.buildSecurityHeader('admin', 'test', { nonceBytes: Buffer.from('0123456789abcdef'), clockOffsetMs: 0 });
  const h2 = ws.buildSecurityHeader('admin', 'test', { nonceBytes: Buffer.from('0123456789abcdef'), clockOffsetMs: 3600 * 1000 });
  const createdOf = (h) => (h.match(/<wsu:Created>([^<]*)</) || [])[1];
  const delta = new Date(createdOf(h2)) - new Date(createdOf(h1));
  ok('clockOffsetMs shifts Created ~+1h', delta > 3590 * 1000 && delta < 3610 * 1000);

  // wsaHeaders carries MessageID (urn:uuid) + anonymous ReplyTo.
  const hdr = soap.wsaHeaders('urn:act', 'http://cam/sub');
  ok('wsa header has MessageID urn:uuid', /<wsa:MessageID>urn:uuid:[0-9a-f-]{36}<\/wsa:MessageID>/.test(hdr));
  ok('wsa header has anonymous ReplyTo', hdr.includes('<wsa:ReplyTo><wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address></wsa:ReplyTo>'));

  // Renew body builder.
  const ev = require('../src/onvif/events');
  const renewBody = ev.buildRenewBody('PT90S');
  ok('renew body wraps wsnt:Renew', renewBody.includes('<wsnt:Renew>') && renewBody.includes('</wsnt:Renew>'));
  ok('renew body carries TerminationTime', renewBody.includes('<wsnt:TerminationTime>PT90S</wsnt:TerminationTime>'));
  eq('renew exported as fn', typeof ev.renew, 'function');

  // Unknown notification schema → still active, does not throw.
  const weird = '<wsnt:NotificationMessage><wsnt:Topic>tns1:Weird/Vendor/Thing</wsnt:Topic>' +
    '<wsnt:Message><VendorBlob foo="bar"/></wsnt:Message></wsnt:NotificationMessage>';
  const notes = ev.parseNotifications(weird);
  eq('weird schema parses 1 note', notes.length, 1);
  eq('weird schema defaults active', notes[0].active, true);

  // Driver contract: subscribeEvents must be null (events run via the global manager).
  const drv = require('../src/drivers/onvif-driver');
  eq('driver subscribeEvents is null', drv.subscribeEvents, null);
}

console.log('audit ulang (2026-07-02): auth-failure detection + IPv6 xaddr');
{
  const soap = require('../src/onvif/soap-client');
  const la = soap._looksLikeAuthFailure;
  eq('401 → auth failure', la({ statusCode: 401, body: '' }), true);
  const notAuth = '<env:Fault><env:Reason><env:Text>Sender not Authorized</env:Text></env:Reason></env:Fault>';
  eq('"Sender not Authorized" fault → auth failure', la({ statusCode: 400, body: notAuth }), true);
  const terNotAuth = '<env:Fault><env:Code><env:Value>env:Sender</env:Value><env:Subcode><env:Value>ter:NotAuthorized</env:Value></env:Subcode></env:Code></env:Fault>';
  eq('ter:NotAuthorized subcode → auth failure', la({ statusCode: 400, body: terNotAuth }), true);
  const genericSender = '<env:Fault><env:Code><env:Value>env:Sender</env:Value></env:Code><env:Reason><env:Text>Invalid request parameter</env:Text></env:Reason></env:Fault>';
  eq('generic env:Sender fault → NOT auth failure', la({ statusCode: 400, body: genericSender }), false);
  eq('200 no fault → NOT auth failure', la({ statusCode: 200, body: '<ok/>' }), false);

  const media = require('../src/onvif/media');
  eq('deviceXAddr IPv4 unchanged', media.deviceXAddr('192.168.1.5', 8080), 'http://192.168.1.5:8080/onvif/device_service');
  eq('deviceXAddr brackets IPv6', media.deviceXAddr('fe80::1', 80), 'http://[fe80::1]:80/onvif/device_service');
  eq('deviceXAddr keeps existing brackets', media.deviceXAddr('[fe80::1]', 80), 'http://[fe80::1]:80/onvif/device_service');
}

// Async tail: the 2MB-cap test needs a real local HTTP server. Everything above
// stays synchronous; the summary/exit moves inside this IIFE.
(async () => {
  console.log('soap-client 2MB cap (local integration)');
  {
    const http = require('http');
    const soap = require('../src/onvif/soap-client');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
      const chunk = Buffer.alloc(512 * 1024, 0x41); // 512 KB of 'A'
      for (let i = 0; i < 6; i++) res.write(chunk); // 3 MB > 2 MB cap
      res.end();
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    let rejected = false, msg = '';
    try {
      await Promise.race([
        soap._httpPost(`http://127.0.0.1:${port}/onvif/device_service`, '<x/>', { timeoutMs: 5000 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG: promise never settled')), 8000).unref()),
      ]);
    } catch (e) { rejected = true; msg = e.message; }
    server.close();
    ok('oversize response REJECTS (not hang)', rejected && !/HUNG/.test(msg));
    ok('rejection names the 2MB cap', /too large/i.test(msg));
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
