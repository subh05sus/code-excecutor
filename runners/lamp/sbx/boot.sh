#!/bin/bash
# A student's live site (SparkMentis practical exams). The executor copies the
# project into /tmp/www/<folder>, the database script into /tmp/init/db.sql and
# then creates /tmp/init/go. This starts MariaDB when there's a database, PHP's
# server on 127.0.0.1:8080, and idles. Everything lives on /tmp (tmpfs); the
# container has no network.
set -u
mkdir -p /tmp/www /tmp/sessions /tmp/uploads /tmp/init /tmp/sfp
for _ in $(seq 1 600); do [ -f /tmp/init/go ] && break; sleep 0.05; done

if [ -f /tmp/init/db.sql ]; then
  D=/tmp/db
  S=/tmp/mysqld.sock
  COMMON=(--no-defaults --datadir="$D" --user=root --lower-case-table-names=1 --innodb-buffer-pool-size=16M --innodb-log-file-size=8M --innodb-data-file-path=ibdata1:8M:autoextend --performance-schema=OFF --aria-pagecache-buffer-size=2M --key-buffer-size=2M)
  if mariadb-install-db "${COMMON[@]}" --auth-root-authentication-method=normal --skip-test-db --skip-name-resolve > /tmp/init/install.log 2>&1; then
    mariadbd "${COMMON[@]}" --socket="$S" --pid-file=/tmp/m.pid --tmpdir=/tmp --bind-address=127.0.0.1 --port=3306 --skip-name-resolve \
      --max-connections=24 --max-statement-time=10 --secure-file-priv=/tmp/sfp --local-infile=0 --table-open-cache=128 \
      --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci > /tmp/init/db.log 2>&1 &
    for _ in $(seq 1 200); do mariadb-admin --no-defaults --socket="$S" --user=root ping > /dev/null 2>&1 && break; sleep 0.05; done
    # XAMPP's root with no password, over TCP as well as the socket.
    mariadb --no-defaults --socket="$S" --user=root -e "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY ''; GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; CREATE USER IF NOT EXISTS 'root'@'::1' IDENTIFIED BY ''; GRANT ALL ON *.* TO 'root'@'::1' WITH GRANT OPTION; FLUSH PRIVILEGES;" > /tmp/init/grants.log 2>&1
    mariadb --no-defaults --socket="$S" --user=root --default-character-set=utf8mb4 < /tmp/init/db.sql > /tmp/init/db-load.log 2>&1
    echo $? > /tmp/init/db-load.status
  else
    echo 1 > /tmp/init/db-load.status
  fi
fi

php -S 127.0.0.1:8080 -t /tmp/www > /tmp/init/php.log 2>&1 &
for _ in $(seq 1 200); do (echo > /dev/tcp/127.0.0.1/8080) > /dev/null 2>&1 && break; sleep 0.05; done
touch /tmp/init/ready
exec sleep infinity
