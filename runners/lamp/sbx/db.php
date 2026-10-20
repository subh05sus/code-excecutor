<?php
// A student's live database, for the workspace's database viewer (SparkMentis
// practical exams): {action: "tables" | "rows" | "query" | "reset", table?,
// sql?, limit?} on stdin, JSON on stdout. Values come back as strings or null.
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
mysqli_report(MYSQLI_REPORT_OFF);

$req = json_decode((string) stream_get_contents(STDIN), true) ?: [];
$name = is_file('/tmp/init/dbname') ? trim((string) file_get_contents('/tmp/init/dbname')) : '';
if ($name === '' || !file_exists('/tmp/mysqld.sock')) { echo json_encode(['error' => 'This question has no database']); exit(0); }

function out(array $a): void { echo json_encode($a, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit(0); }

$action = (string) ($req['action'] ?? 'tables');
if ($action === 'reset') {
  $sock = '/tmp/mysqld.sock';
  $drop = sprintf("DROP DATABASE IF EXISTS `%s`;", str_replace('`', '', $name));
  exec('mariadb --no-defaults --socket=' . $sock . ' --user=root -e ' . escapeshellarg($drop) . ' 2>&1', $o1, $c1);
  exec('mariadb --no-defaults --socket=' . $sock . ' --user=root --default-character-set=utf8mb4 < /tmp/init/db.sql 2>&1', $o2, $c2);
  out($c1 === 0 && $c2 === 0 ? ['ok' => true] : ['error' => substr(implode("\n", array_merge($o1, $o2)), 0, 2000)]);
}

$db = @new mysqli('localhost', 'root', '', $name);
if ($db->connect_errno) out(['error' => 'The database is not available: ' . $db->connect_error]);
$db->set_charset('utf8mb4');

function rows(mysqli_result $r, int $limit): array {
  $cols = array_map(fn($f) => $f->name, $r->fetch_fields());
  $rows = [];
  while (($row = $r->fetch_row()) && count($rows) < $limit) $rows[] = array_map(fn($v) => $v === null ? null : (string) $v, $row);
  return ['columns' => $cols, 'rows' => $rows, 'more' => $r->num_rows > count($rows)];
}

if ($action === 'tables') {
  $r = $db->query('SHOW FULL TABLES');
  $tables = [];
  while ($r && ($t = $r->fetch_row())) {
    $count = $db->query('SELECT COUNT(*) FROM `' . str_replace('`', '``', $t[0]) . '`');
    $tables[] = ['name' => $t[0], 'type' => $t[1] === 'VIEW' ? 'view' : 'table', 'rows' => $count ? (int) $count->fetch_row()[0] : null];
  }
  out(['database' => $name, 'tables' => $tables]);
}
if ($action === 'rows') {
  $table = (string) ($req['table'] ?? '');
  $limit = max(1, min(500, (int) ($req['limit'] ?? 200)));
  $r = $db->query('SELECT * FROM `' . str_replace('`', '``', $table) . '` LIMIT ' . ($limit + 1));
  if (!$r) out(['error' => $db->error]);
  out(rows($r, $limit));
}
if ($action === 'query') {
  $sql = (string) ($req['sql'] ?? '');
  if (trim($sql) === '') out(['error' => 'Type a query']);
  $r = $db->query($sql);
  if ($r === false) out(['error' => $db->error]);
  if ($r === true) out(['affected' => $db->affected_rows]);
  out(rows($r, 500));
}
out(['error' => 'Unknown action']);
