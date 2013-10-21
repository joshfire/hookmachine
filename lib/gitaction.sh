#!/bin/bash
#######################################################
# Script that retrieves the latest version of a repo
# and runs the given script on the given branch when
# done.
#
# The script takes 5 parameters:
# - the origin URL of the repo
# - the relative path to the "data" folder that will
# contain the "repositories" folder
# - the branch to switch to
# - the relative path (from the root of the repo) to
# the script to run
# - the relative path (from the root of the repo) to
# the script to run to check whether the first script
# needs to run or not.
#
# The last parameter is optional. In its absence, the
# first script will be run no matter what. If present,
# the underlying script must exit with exit code 42 if
# the first script needs to run, something else not to
# run the first script.
#
# TODO: when "npm install" fails, the local repo folder
# should be removed before the script returns an error,
# because subsequent runs of the script will take for
# granted that the repo is up and running otherwise.
#######################################################

REPO=$1
DATAFOLDER=$2
BRANCH=$3
SCRIPT=$4
CHECK=$5

echo "Retrieve latest version of ${REPO} (branch ${BRANCH})..."

if [ -z "${REPO}" ]
then
  echo ""
  echo "No Git URL specified!"
  echo ""
  exit 1
fi

if [ -z "${BRANCH}" ]
then
  echo ""
  echo "No branch specified!"
  echo ""
  exit 1
fi

if [ -z "${SCRIPT}" ]
then
  echo ""
  echo "No script to run!"
  echo ""
  exit 1
fi

# Automatic error handling
set -e

echo "Create repositories folder if needed..."
if [ ! -d "${DATAFOLDER}" ]
then
  mkdir ${DATAFOLDER}
fi
cd ${DATAFOLDER}

if [ ! -d "repositories" ]
then
  mkdir repositories
  echo "Create repositories folder if needed... done"
else
  echo "Create repositories folder if needed... not needed"
fi

cd repositories
REPOFOLDER=${REPO//[:@\.\/]/-}
if [ ! -d "${REPOFOLDER}" ]
then
  echo "Clone repository..."
  git clone ${REPO} ${REPOFOLDER}
  cd ${REPOFOLDER}
  ../../../node_modules/.bin/npm install
  cd ..
  echo "Clone repository... done"
fi
cd ${REPOFOLDER}

echo "Switch to branch ${BRANCH}..."
git fetch origin
git checkout ${BRANCH}
echo "Switch to branch ${BRANCH}... done"

echo "Ensure we have latest version of ${BRANCH} branch..."
remote=$(git log HEAD..origin/${BRANCH} --oneline)
if [ "${remote}" != "" ]
then
  echo "Pull latest version of repository..."
  git pull
  ../../../node_modules/.bin/npm install
  echo "Pull latest version of repository... done"
fi
echo "Ensure we have latest version of ${BRANCH} branch... done"

echo "Retrieve latest version of ${REPO} (branch ${BRANCH})... done"
echo ""

# Back to manual error handling
set +e

needsUpdate=42
if [ ! -z "${CHECK}" ]
then
  echo "Run check script..."
  ${CHECK}
  needsUpdate=$?
  echo "Run check script... done, response=${needsUpdate}"
fi

if [ "${needsUpdate}" == "42" ]
then
  echo "Run action script..."
  ${SCRIPT}
  result=$?
  echo "Run action script... done, result=${result}"
else
  echo "No update needed"
fi

cd ../../..

exit ${result}
