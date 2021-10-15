# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM gcr.io/kpt-dev/kpt:latest

RUN apk add --update --no-cache npm ca-certificates wget diffutils \
    && update-ca-certificates

RUN wget https://github.com/cli/cli/releases/download/v1.1.0/gh_1.1.0_linux_386.tar.gz \
    && tar -zxvf gh_1.1.0_linux_386.tar.gz \
    && mv gh_1.1.0_linux_386/bin/gh /usr/local/bin \
    && chmod u+x /usr/local/bin/gh