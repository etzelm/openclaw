#!/bin/bash
cd ~/work/pr165112r2/proof
(./run-case.sh root 20100 & ./run-case.sh subdir 20110 & ./run-case.sh neither 20120 & ./run-case.sh both 20130 & wait)
(./run-case.sh agentsmd 20140 & ./run-case.sh env 20150 & ./run-case.sh tilde 20160 & ./run-case.sh include 20170 & wait)
echo done > all.done
