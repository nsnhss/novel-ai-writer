@echo off
curl -s -o NUL -w "140.82.112.3: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:140.82.112.3 https://github.com
curl -s -o NUL -w "140.82.113.3: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:140.82.113.3 https://github.com
curl -s -o NUL -w "140.82.114.3: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:140.82.114.3 https://github.com
curl -s -o NUL -w "140.82.116.3: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:140.82.116.3 https://github.com
curl -s -o NUL -w "140.82.121.3: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:140.82.121.3 https://github.com
curl -s -o NUL -w "20.205.243.166: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:20.205.243.166 https://github.com
curl -s -o NUL -w "20.27.177.113: %%{http_code} %%{time_total}s\n" --connect-timeout 6 --resolve github.com:443:20.27.177.113 https://github.com
