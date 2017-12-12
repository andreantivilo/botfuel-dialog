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
const logger = require('logtown')('DialogManager');
const Dialog = require('./dialogs/dialog');
const { DialogError } = require('./errors/index');

/**
 * The dialog manager turns NLU output into a dialog stack.
 *
 * The dialog manager has access to:
 * - the bot {@link Brain}.
 */
class DialogManager {
  /**
   * @constructor
   * @param {Object} brain - the bot brain
   * @param {Object} config - the bot config
   */
  constructor(brain, config) {
    this.brain = brain;
    this.config = config;
  }

  /**
   * Gets the dialog path.
   * @param {String} name - the dialog's name
   * @returns {String|null} - the dialog path if found or null
   */
  getDialogPath(name) {
    logger.debug('getDialogPath', name);
    const paths = [
      `${this.config.path}/src/dialogs/${name}-dialog.${this.config.adapter}`,
      `${this.config.path}/src/dialogs/${name}-dialog`,
      `${__dirname}/dialogs/${name}-dialog.${this.config.adapter}`,
      `${__dirname}/dialogs/${name}-dialog`,
    ];
    for (const path of paths) {
      logger.debug('getDialogPath: path', path);
      if (fs.existsSync(`${path}.js`)) {
        return path;
      }
    }
    return null;
  }

  /**
   * Gets the dialog.
   * @param {Object} dialog - object which has a name
   * @returns {Dialog} - the dialog instance
   */
  getDialog(dialog) {
    logger.debug('getDialog', dialog);
    const path = this.getDialogPath(dialog.name);
    if (path) {
      const DialogConstructor = require(path);
      return new DialogConstructor(this.config, this.brain, DialogConstructor.params);
    }
    logger.error(`Could not resolve '${dialog.name}' dialog`);
    throw new DialogError({ dialog, message: `Make sure the '${dialog.name}' dialog file exists at ${this.config.path}/src/dialogs/${dialog.name}-dialog.js` });
  }

  /**
   * Sorts intents
   * @param {Object[]} intents - the intents
   * @returns {Object[]} the sorted intents
   */
  sortIntents(intents) {
    logger.debug('sortIntents', intents);
    return intents
      .sort((intent1, intent2) => {
        const dialog1 = this.getDialog(intent1);
        const dialog2 = this.getDialog(intent2);
        const reentrant1 = dialog1.characteristics.reentrant;
        const reentrant2 = dialog2.characteristics.reentrant;
        if (reentrant1 && !reentrant2) {
          return 1;
        }
        if (!reentrant1 && reentrant2) {
          return -1;
        }
        return 0;
      });
  }

  /**
   * Returns the last dialog to execute if no other dialog is found.
   * @param {Object[]} previousDialogs - the previous dialogs
   * @returns {String} a dialog name
   */
  getLastDialog(previousDialogs) {
    for (let i = previousDialogs.length - 1; i >= 0; i--) {
      const dialog = previousDialogs[i];
      if (dialog.characteristics.reentrant) {
        return dialog;
      }
    }
    return null;
  }

  /**
   * Returns the dialogs data (stack and previous dialogs).
   * @param {String} userId - the user id
   * @returns {Promise.<Object[]>} the data
   */
  async getDialogs(userId) {
    logger.debug('getDialogs', userId);
    return this.brain.userGet(userId, 'dialogs');
  }

  /**
   * Sets the dialogs data (stack and previous dialogs).
   * @param {String} userId - the user id
   * @param {Object} dialogs - the dialogs data
   * @returns {void}
   */
  async setDialogs(userId, dialogs) {
    logger.debug('setDialogs', userId, dialogs);
    return this.brain.userSet(userId, 'dialogs', dialogs);
  }

  /**
   * Updates the dialogs.
   * @param {String} userId - the user id
   * @param {Object} dialogs - the dialogs data
   * @param {Object[]} intents - the intents
   * @param {Object[]} entities - the entities
   * @returns {void}
   */
  updateWithIntents(userId, dialogs, intents, entities) {
    logger.debug('updateWithIntents', userId, dialogs, intents, entities);
    intents = this.sortIntents(intents);
    logger.debug('updateWithIntents: intents', intents);
    let nb = 0;
    const newDialogs = [];
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      const dialogInstance = this.getDialog(intent);
      if (dialogInstance.characteristics.reentrant) {
        nb++;
      }
      newDialogs.push({
        name: intent.name,
        characteristics: dialogInstance.characteristics,
        entities,
        blocked: nb > 1,
      });
    }
    this.updateWithDialogs(dialogs, newDialogs);
    if (dialogs.stack.length === 0) { // no intent detected
      const lastDialog = this.getLastDialog(dialogs.previous) || {
        name: 'default',
        characteristics: {
          reentrant: false,
        },
      };
      dialogs.stack.push({
        ...lastDialog,
        entities: entities || [],
      });
    }
    if (entities) {
      dialogs.stack[dialogs.stack.length - 1].entities = entities;
    }
  }

  /**
   * Updates the dialogs.
   * @param {Object} dialogs - the dialogs data
   * @param {Object[]} newDialogs - new dialogs to be added to the dialog stack
   * @returns {void}
   */
  updateWithDialogs(dialogs, newDialogs) {
    for (let i = newDialogs.length - 1; i >= 0; i--) {
      const newDialog = newDialogs[i];
      const lastIndex = dialogs.stack.length - 1;
      const lastDialog = lastIndex >= 0 ? dialogs.stack[lastIndex] : null;
      if (lastDialog && lastDialog.name === newDialog.name) {
        lastDialog.entities = newDialog.entities;
      } else {
        dialogs.stack.push(newDialog);
      }
    }
  }

  /**
   * Applies an action to the dialogs object.
   * @async
   * @param {Object} dialogs - the dialogs object to be updated
   * @param {String} action - an action that indicates
   * how should the stack and previous dialogs be updated
   * @returns {Promise.<Object>} The new dialogs object with its stack and previous arrays updated
    */
  applyAction(dialogs, { name, newDialog }) {
    logger.debug('applyAction', dialogs, { name, newDialog });
    const currentDialog = dialogs.stack[dialogs.stack.length - 1];
    const previousDialog = dialogs.stack[dialogs.stack.length - 2];
    const date = Date.now();

    switch (name) {
      case Dialog.ACTION_CANCEL:
        logger.debug('applyAction: cancelling previous dialog', previousDialog);
        dialogs = {
          stack: dialogs.stack.slice(0, -2),
          previous: [
            ...dialogs.previous,
            { ...currentDialog, date },
          ],
        };
        if (newDialog) {
          this.updateWithDialogs(dialogs, [newDialog]);
        }
        return dialogs;

      case Dialog.ACTION_COMPLETE:
        return {
          stack: dialogs.stack.slice(0, -1),
          previous: [
            ...dialogs.previous,
            { ...currentDialog, date },
          ],
        };

      case Dialog.ACTION_NEXT:
        dialogs = {
          stack: dialogs.stack.slice(0, -1),
          previous: [
            ...dialogs.previous,
            { ...currentDialog, date },
          ],
        };
        this.updateWithDialogs(dialogs, [newDialog]);
        return dialogs;

      default:
        throw new DialogError({ dialog: currentDialog, message: `Unknown action '${name}' in '${currentDialog.name}'` });
    }
  }

  /**
   * Executes the dialogs.
   * @async
   * @param {Adapter} adapter - the adapter
   * @param {String} userId - the user id
   * @param {Object[]} dialogs - the dialogs data
   * @returns {Promise.<void>}
   */
  async execute(adapter, userId, dialogs) {
    logger.debug('execute', '<adapter>', userId, dialogs);
    if (dialogs.stack.length === 0) {
      return dialogs;
    }
    const dialog = dialogs.stack[dialogs.stack.length - 1];
    if (dialog.blocked) {
      dialog.blocked = false;
      const confirmationDialogName = this.getDialogPath(`${dialog.name}-confirmation`)
            ? `${dialog.name}-confirmation`
            : 'confirmation';
      dialogs.stack.push({
        name: confirmationDialogName,
        characteristics: {
          reentrant: false,
        },
        entities: [],
      });
    } else {
      const dialogInstance = this.getDialog(dialog);
      const action = await dialogInstance.execute(adapter, userId, dialog.entities);
      logger.debug('execute: action', action);
      if (action.name === Dialog.ACTION_WAIT) {
        return dialogs;
      }
      dialogs = await this.applyAction(dialogs, action);
    }
    return this.execute(adapter, userId, dialogs);
  }

  /**
   * Populates and executes the stack.
   * @param {Adapter} adapter - the adapter
   * @param {String} userId - the user id
   * @param {String[]} intents - the intents
   * @param {Object[]} entities - the transient entities
   * @returns {Promise.<void>}
   */
  async executeIntents(adapter, userId, intents, entities) {
    logger.debug('execute', userId, intents, entities);
    const dialogs = await this.getDialogs(userId);
    this.updateWithIntents(userId, dialogs, intents, entities);
    return this.setDialogs(userId, await this.execute(adapter, userId, dialogs));
  }

  /**
   * Populates and executes the stack.
   * @param {Adapter} adapter - the adapter
   * @param {String} userId - the user id
   * @param {Object[]} newDialogs - the new dialogs
   * @returns {Promise.<void>}
   */
  async executeDialogs(adapter, userId, newDialogs) {
    logger.debug('executeWithDialogs', userId, newDialogs);
    const dialogs = await this.getDialogs(userId);
    this.updateWithDialogs(dialogs, newDialogs);
    return this.setDialogs(userId, await this.execute(adapter, userId, dialogs));
  }
}

module.exports = DialogManager;