/**
 * Copyright (c) 2017 - present, Botfuel (https://www.botfuel.io).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const rp = require('request-promise-native');
const dir = require('node-dir');
const logger = require('logtown')('BotfuelTrainerNlu');
const BooleanExtractor = require('../extractors/boolean-extractor');
const LocationExtractor = require('../extractors/location-extractor');
const CompositeExtractor = require('../extractors/composite-extractor');
const SdkError = require('../errors/sdk-error');
const ClassificationResult = require('./classification-result');
const Nlu = require('./nlu');

/**
 * NLU using Botfuel Trainer API
 */
class BotfuelTrainerNlu extends Nlu {
  /** @inheritdoc */
  constructor(config) {
    logger.debug('constructor', config);
    super(config);
    this.extractor = null;

    if (!process.env.BOTFUEL_APP_TOKEN) {
      throw new SdkError('BOTFUEL_APP_TOKEN are required for using the nlu service');
    }
  }

  /**
   * Gets extractor files.
   * @param {String} path - extractors path
   * @returns {Array.<string>} - extractor files
   */
  getExtractorFiles(path) {
    let files = [];
    if (fs.existsSync(path)) {
      files = dir.files(path, { sync: true }) || files;
    }
    return files.filter(file => file.match(/^.*.js$/));
  }

  /**
   * Gets extractors.
   * @param {String} path - extractors path
   * @returns {Array.<*>} - extractor instances
   */
  getExtractors(path) {
    // user extractors
    const extractors = this.getExtractorFiles(path).map((file) => {
      const ExtractorConstructor = require(file);
      return new ExtractorConstructor(ExtractorConstructor.params);
    });
    // system extractors
    extractors.push(new BooleanExtractor({ locale: this.config.locale }));
    extractors.push(new LocationExtractor({}));
    return extractors;
  }

  /** @inheritdoc */
  async init() {
    logger.debug('init');
    super.init();

    // Extractors
    this.extractor = new CompositeExtractor({
      extractors: this.getExtractors(`${this.config.path}/src/extractors`),
    });
  }

  /** @inheritdoc */
  async compute(sentence /* context */) {
    logger.debug('compute', sentence);

    // compute entities
    const messageEntities = await this.computeEntities(sentence);

    // compute intents
    let trainerUrl =
      process.env.BOTFUEL_TRAINER_API_URL || 'https://trainer-api-staging.herokuapp.com/api/v0';

    if (trainerUrl.slice(-1) !== '/') {
      trainerUrl += '/';
    }

    const options = {
      uri: `${trainerUrl}classify`,
      qs: {
        sentence,
      },
      headers: {
        'Botfuel-Bot-Id': process.env.BOTFUEL_APP_TOKEN,
      },
      json: true,
    };

    const res = await rp(options);

    const classificationResults = res.map(data => new ClassificationResult(data));

    return { messageEntities, classificationResults };
  }

  /**
   * Computes entities using the classifier.
   * @param {String} sentence - the user sentence
   * @returns {Object} entities
   */
  async computeEntities(sentence) {
    logger.debug('computeEntities', sentence);
    const entities = await this.extractor.compute(sentence);
    return entities;
  }
}

module.exports = BotfuelTrainerNlu;