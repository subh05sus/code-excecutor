<?php
// One request to a student's live site (SparkMentis practical exams). Reads
// {method, path, headers, body (base64), follow} on stdin, sends it to PHP's
// server on 127.0.0.1:8080 with the site's cookie jar (so sessions work
// across clicks), follows redirects like a browser, and prints
// {status, headers, body (base64), url, hops, log, ms} as JSON.
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');

$req = json_decode((string) stream_get_contents(STDIN), true);
if (!is_array($req)) { echo json_encode(['error' => 'bad request']); exit(0); }
for ($i = 0; $i < 300 && !file_exists('/tmp/init/ready'); $i++) usleep(50000);
if (!file_exists('/tmp/init/ready')) { echo json_encode(['error' => 'The site is still starting']); exit(0); }

const JAR = '/tmp/init/cookies.json';
const LOG = '/tmp/init/php.log';
const MAX_BODY = 6000000;

$jar = is_file(JAR) ? (json_decode((string) file_get_contents(JAR), true) ?: []) : [];
$logFrom = is_file(LOG) ? filesize(LOG) : 0;

function jar_set(array &$jar, string $line): void {
  $parts = explode(';', $line);
  $kv = explode('=', (string) array_shift($parts), 2);
  $name = trim($kv[0]);
  $value = trim($kv[1] ?? '');
  if ($name === '') return;
  $gone = ($value === '' || $value === 'deleted');
  foreach ($parts as $a) {
    $a = trim($a);
    if (stripos($a, 'max-age=') === 0 && (int) substr($a, 8) <= 0) $gone = true;
    if (stripos($a, 'expires=') === 0) { $ts = strtotime(substr($a, 8)); if ($ts !== false && $ts < time()) $gone = true; }
  }
  if ($gone) unset($jar[$name]); else $jar[$name] = $value;
}

function send(string $method, string $target, array $headers, string $body, array &$jar): array {
  $lines = ['Host: localhost', 'Connection: close'];
  foreach ($headers as $k => $v) {
    $lk = strtolower((string) $k);
    if (in_array($lk, ['host', 'connection', 'cookie', 'content-length', 'accept-encoding'], true)) continue;
    $lines[] = $k . ': ' . str_replace(["\r", "\n"], '', (string) $v);
  }
  if ($body !== '' || in_array($method, ['POST', 'PUT', 'PATCH'], true)) $lines[] = 'Content-Length: ' . strlen($body);
  if ($jar) {
    $c = [];
    foreach ($jar as $k => $v) $c[] = $k . '=' . $v;
    $lines[] = 'Cookie: ' . implode('; ', $c);
  }
  $s = @fsockopen('127.0.0.1', 8080, $en, $es, 3);
  if (!$s) return ['error' => 'The site stopped responding'];
  stream_set_timeout($s, 12);
  fwrite($s, $method . ' ' . $target . " HTTP/1.0\r\n" . implode("\r\n", $lines) . "\r\n\r\n" . $body);
  $raw = '';
  while (!feof($s)) {
    $chunk = fread($s, 65536);
    if ($chunk === false) break;
    if ($chunk === '') { if (stream_get_meta_data($s)['timed_out']) break; continue; }
    $raw .= $chunk;
    if (strlen($raw) > MAX_BODY) break;
  }
  $timedOut = stream_get_meta_data($s)['timed_out'];
  fclose($s);
  if ($timedOut && strpos($raw, "\r\n\r\n") === false) return ['error' => 'The page took too long to respond (over 12 seconds)'];
  $cut = strpos($raw, "\r\n\r\n");
  $head = $cut === false ? $raw : substr($raw, 0, $cut);
  $resp = $cut === false ? '' : substr($raw, $cut + 4);
  $hl = explode("\r\n", $head);
  $status = preg_match('#^HTTP/\S+\s+(\d{3})#', $hl[0] ?? '', $m) ? (int) $m[1] : 0;
  $out = [];
  $location = null;
  foreach (array_slice($hl, 1) as $h) {
    $p = strpos($h, ':');
    if ($p === false) continue;
    $name = trim(substr($h, 0, $p));
    $val = trim(substr($h, $p + 1));
    $out[] = [$name, $val];
    if (strtolower($name) === 'location') $location = $val;
    if (strtolower($name) === 'set-cookie') jar_set($jar, $val);
  }
  return ['status' => $status, 'headers' => $out, 'location' => $location, 'body' => $resp];
}

/** A Location header against the current path: "/site/a.php" stays, "b.php" resolves, "http://localhost/x" → "/x". */
function resolve(string $base, string $loc): string {
  if (preg_match('#^https?://[^/]+(/.*)?$#i', $loc, $m)) return $m[1] ?? '/';
  if ($loc !== '' && $loc[0] === '/') return $loc;
  $dir = substr($base, 0, (int) strrpos(explode('?', $base)[0], '/') + 1);
  $out = [];
  foreach (explode('/', $dir . $loc) as $seg) {
    if ($seg === '..') { if (count($out) > 1) array_pop($out); continue; }
    if ($seg === '.') continue;
    $out[] = $seg;
  }
  return implode('/', $out);
}

$t0 = microtime(true);
$method = strtoupper((string) ($req['method'] ?? 'GET'));
$target = (string) ($req['path'] ?? '/');
if ($target === '' || $target[0] !== '/') $target = '/' . $target;
$headers = is_array($req['headers'] ?? null) ? $req['headers'] : [];
$body = isset($req['body']) && is_string($req['body']) ? (string) base64_decode($req['body']) : '';
$follow = ($req['follow'] ?? true) !== false;

$hops = 0;
$r = send($method, $target, $headers, $body, $jar);
while ($follow && !isset($r['error']) && in_array($r['status'], [301, 302, 303, 307, 308], true) && $r['location'] !== null && $hops < 5) {
  $hops++;
  $target = resolve($target, $r['location']);
  if (in_array($r['status'], [301, 302, 303], true)) { $method = 'GET'; $body = ''; $headers = array_filter($headers, fn($k) => strtolower((string) $k) !== 'content-type', ARRAY_FILTER_USE_KEY); }
  $r = send($method, $target, $headers, $body, $jar);
}
file_put_contents(JAR, json_encode($jar));

$log = '';
if (is_file(LOG)) {
  clearstatcache();
  $size = filesize(LOG);
  if ($size > $logFrom) $log = (string) file_get_contents(LOG, false, null, $logFrom, min(20000, $size - $logFrom));
}
if (isset($r['error'])) { echo json_encode(['error' => $r['error'], 'log' => $log]); exit(0); }
echo json_encode([
  'status' => $r['status'],
  'headers' => $r['headers'],
  'body' => base64_encode($r['body']),
  'url' => $target,
  'hops' => $hops,
  'log' => $log,
  'ms' => (int) round((microtime(true) - $t0) * 1000),
], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES);
