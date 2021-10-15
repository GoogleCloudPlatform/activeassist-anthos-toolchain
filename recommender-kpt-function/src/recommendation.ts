// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export class Recommendation {
  public name?: string;
  public description?: string;
  public lastRefreshTime?: string;
  public content?: RecommendationContent;
  public etag?: string;
  public recommenderSubtype?: string;
}

export class RecommendationContent {
  public operationGroups?: RecommendationOperationGroup[]
}

export class RecommendationOperationGroup {
  public operations?: RecommendationOperation[]
}

export class RecommendationOperation {
  public action?: string;
  public resourceType?: string;
  public resource?: string;
  public path?: string;
  public value?: string;
  public valueMatcher?: RecommendationOperationValueMatcher;
}

export class RecommendationOperationValueMatcher {
  public matchesPattern?: string;
}

export class Recommendations {
  public recommendations?: Recommendation[];
}