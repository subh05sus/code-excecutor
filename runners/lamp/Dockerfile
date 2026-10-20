# PHP + MySQL (MariaDB), as in XAMPP (SparkMentis practical exams, 2026-10-20).
# Two uses:
#  - one-shot full-stack checks: the app's run.sh boots the database on /tmp,
#    loads the question's tables and rows, and replays the checks;
#  - live student sites (sbx/boot.sh): the database and `php -S` stay up while
#    the student works; requests and database views go through sbx/*.php.
# Built by the executor when missing (LanguageConfig.build).
FROM mariadb:11.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends php8.3-cli php8.3-mysql php8.3-mbstring php8.3-xml php8.3-gd php8.3-curl php8.3-sqlite3 \
 && rm -rf /var/lib/apt/lists/*
COPY php.ini /etc/php/8.3/cli/conf.d/99-sparkmentis.ini
COPY sbx/ /opt/sbx/
RUN chmod 755 /opt/sbx/boot.sh && php -m | grep -qi mysqli && php -m | grep -qi pdo_mysql
