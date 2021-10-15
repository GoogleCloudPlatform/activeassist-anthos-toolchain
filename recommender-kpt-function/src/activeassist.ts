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

import {Configs} from 'kpt-functions';
import request from 'request-promise';
import {google} from 'googleapis';
import {readFile} from 'fs';

import {isNamespace, Namespace} from './gen/io.k8s.api.core.v1';
import {ComputeInstance, isComputeInstance} from './compute_instance';
import {Recommendations, Recommendation, RecommendationOperation} from './recommendation';

const BASE_ENDPOINT='recommender.googleapis.com/v1/projects';

/**
 * Main entry point to the kpt function. It looks at all KRMs of type
 * ComputeInstance, calls the recommender API for each of them to check if
 * there are any machine size recommendations and for each recommendation
 * mutates the corresponding KRM
 *
 * @param {Configs} configs list of KRM configs
 */
export async function activeassist(configs: Configs) {
  const vms: ComputeInstance[] = configs.getAll().filter(isComputeInstance);

  const namespacesWithProjectId: Map<string, string> =
    getNamespacesWithProjectID(configs);
  console.log('namespacesWithProjectId', namespacesWithProjectId);

  // Collect list of projects with locations
  const projectWithLocations: Map<string, string[]> =
    getProjectWithLocations(vms, namespacesWithProjectId);
  console.log('projectWithLocations', projectWithLocations);

  // Set scopes for auth request
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  // Get auth client and token
  const authClient = await auth.getClient();

  const token = (await authClient.getAccessToken())?.token || '';

  const stubProject = process.env.STUB_PROJECT;
  let recommendations = [];
  if (!stubProject) {
    recommendations = await getAllRecommendations(projectWithLocations, token);
  } else {
    recommendations = await getRecommendationsFromStub(stubProject);
  }

  console.log('recommendations', JSON.stringify(recommendations, null, 2));

  // Filter recommendations which are not for operation = 'replace'
  const recommendationsToApply =
    recommendations.filter(filterRecommendations);

  const vmsMap = new Map();

  // Construct a map from VM resource identifiers to VM config object
  vms.forEach((vm) => {
    const vmNamespace = vm.metadata.namespace;
    if (vmNamespace && vm.spec) {
      const vmProject = namespacesWithProjectId.get(vmNamespace);

      if (vmProject) {
        // Construct the VM's resource path, as used by recommender
        // https://cloud.google.com/recommender/docs/using-api#list_recommendations
        const vmResource = '//compute.googleapis.com/projects/' +
          `${vmProject}/zones/${vm.spec?.zone}/instances/${vm.metadata.name}`;
        vmsMap.set(vmResource.toLowerCase(), vm);
      }
    }
  });
  console.log('vmsMap', vmsMap);

  // Mutate configs according to recommendations
  recommendationsToApply.forEach((rec) => {
    // Iterate all the operations in each recommender
    // and apply recommendations to replace VM machine type
    rec.content?.operationGroups?.forEach((g) =>
      g.operations?.forEach((operation) => {
        if (operation.action == 'replace' &&
            vmsMap.has(operation.resource?.toLowerCase())) {
          const vm = vmsMap.get(operation.resource);
          vm.spec.machineType = getMachineType(operation);
        }
      }));
  });

  console.log('vms modified', vms);
}

/**
 * Fetches the project ID annotation from each namespace KRM and creates a
 * lookup map
 *
 * @param {Configs} configs list of KRM configs
 * @return {Map<string, string>} a map containing the namespace and the project
 * ID associated to each
 */
function getNamespacesWithProjectID(configs: Configs): Map<string, string> {
  return configs.getAll().filter(isNamespace)
      .reduce((acc: Map<string, string>, val: Namespace) => {
        if (val?.metadata?.annotations) {
          if ('cnrm.cloud.google.com/project-id' in
              val?.metadata?.annotations) {
            acc.set(
                val.metadata.name,
                val?.metadata?.annotations['cnrm.cloud.google.com/project-id']);
          }
        }
        return acc;
      }, new Map());
}

/**
 * This function looks at each ComputeInstance in the KRM and returns a map of
 * the various locations (zones) where those Vms are located
 *
 * @param {ComputeInstance[]} vms list of Compute Instance KRMs
 * @param {Map<string, string>} namespacesWithProjectId list of namespaces with
 * their corresponding projectID
 * @return {Map<string, string[]>} a map containing the various projects and
 * all the locations for the VMs
 */
function getProjectWithLocations(vms: ComputeInstance[],
    namespacesWithProjectId: Map<string, string>): Map<string, string[]> {
  return vms.reduce((acc: Map<string, string[]>, val: ComputeInstance) => {
    const ns = val.metadata.namespace;
    const location = val.spec?.zone;
    if (ns && location) {
      if (namespacesWithProjectId.has(ns)) {
        const project = namespacesWithProjectId.get(ns);

        if (project) {
          const locations = acc.get(project) || [];
          locations.push(location);
          acc.set(project, locations);
        }
      }
    }

    return acc;
  }, new Map());
}

/**
 * This function fetches all recommendations from the GCP VM recommender for
 * specific projects and locations
 *
 * @param {Map<string, string[]>} projectWithLocations list of projects and all
 * the locations from the KRMs
 * @param {string} token GCP access token used to make the API call
 * @return {Promise<Recommendation[]>} a list of recommendations
 * from recommender
 */
async function getAllRecommendations(
    projectWithLocations: Map<string, string[]>,
    token: string): Promise<Recommendation[]> {
  const promises : Promise<Recommendations>[] = [];

  // Get recommendations for each combination of project + location (zone)
  projectWithLocations.forEach((locations, project) => {
    locations.forEach((location) => {
      promises.push(invokeRecommendationAPI(project, location, token));
    });
  });

  // Wait for all recommendations to be fetched
  const recommendations = await Promise.all(promises);

  // Flatten a Recommendations[] array to a Recommendation[] array
  // The Recommendations.recommendations property is a Recommendation[] array
  return recommendations.reduce(
      (acc: Recommendation[], value: Recommendations) => {
        if (value.recommendations) {
          return acc.concat(value.recommendations);
        }
        return acc;
      }, []);
}

/**
 * Fetch recommendations from the GCP VM recommender for the
 * given project and location
 *
 * @param {string} project Project ID to look recommendations for
 * @param {string} location Location (Zone in case of a VM)
 * to look recommendations for
 * @param {string} token GCP access token used to make the API call
 * @return {Promise<Recommendations>} a list of recommendations from recommender
 */
async function invokeRecommendationAPI(
    project: string,
    location: string,
    token: string): Promise<Recommendations> {
  const options = {
    uri: `https://${BASE_ENDPOINT}/${project}/locations/${location}/recommenders/google.compute.instance.MachineTypeRecommender/recommendations`,
    headers: {
      'x-goog-user-project': project,
      'Authorization': `Bearer ${token}`,
    },
    json: true,
  };

  return request(options);
}

/**
 * This function filters recommendations from recommender which are of
 * CHANGE_MACHINE_TYPE and where the action is replace
 *
 * @param {Recommendation} recommendation Recommendation to test
 * @return {Boolean} is it a valid recommendation
 */
function filterRecommendations(recommendation: Recommendation): Boolean {
  const groups = recommendation.content?.operationGroups;
  if (recommendation.recommenderSubtype == 'CHANGE_MACHINE_TYPE' && groups) {
    for (const group of groups) {
      if (group.operations) {
        for (const operation of group.operations) {
          if (operation.action == 'replace') {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Fetches recommendation from a stub. It replaces the project ID in the stub
 * with the provided project ID
 *
 * @param {string} stubProject Project ID of the stub project
 * @return {Promise<Recommendation[]>} list of recommendations from the stub
 */
function getRecommendationsFromStub(stubProject: string) :
  Promise<Recommendation[]> {
  return new Promise((resolve, reject) => {
    readFile('stub.json', (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(JSON.parse(data.toString().replace(/_PROJECT_/g, stubProject)));
    });
  });
}

/**
 * Gets the machine type element from the recommendation operation.
 *
 * @param {RecommendationOperation} operation from the recommender response
 * @return {string} machine type from the recommender operation
 */
function getMachineType(operation: RecommendationOperation): string {
  // Operation value format: zones/ZONE_NAME/machineTypes/MACHINE_TYPE
  // https://cloud.google.com/recommender/docs/using-api#list_recommendations
  const parts = operation.value?.split('/') || [''];
  return parts[parts.length - 1];
}

activeassist.usage = `
It looks at all KRMs of type ComputeInstance, calls the recommender API for
each of them to check if there are any machine size recommendations and for each
recommendation it mutates the corresponding KRM
`;
