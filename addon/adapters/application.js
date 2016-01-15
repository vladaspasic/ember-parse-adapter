import Ember from 'ember';
import DS from 'ember-data';
import computed from 'ember-new-computed';

export default DS.RESTAdapter.extend({
  defaultSerializer: '-parse',

  host: 'https://api.parse.com',

  namespace: '1',

  classesPath: 'classes',

  /**
   * Resolves the Parse API path for a a certain request type.
   * 
   * @param  {String} type
   * @return {String}
   */
  pathForType: function(type) {
    if ('parseUser' === type) {
      return 'users';
    } else if ('login' === type) {
      return 'login';
    } else {
      return this.classesPath + '/' + this.parsePathForType(type);
    }
  },

  // Using TitleStyle is recommended by Parse
  // @TODO: test
  parsePathForType: function(type) {
    return Ember.String.capitalize(Ember.String.camelize(type));
  },

  /**
   * Because Parse doesn't return a full set of properties on the
   * responses to updates, we want to perform a merge of the response
   * properties onto existing data so that the record maintains
   * latest data.
   */
  createRecord: function(store, type, snapshot) {
    var serializer = store.serializerFor(type.modelName),
      data = {};

    serializer.serializeIntoHash(data, type, snapshot, {
      includeId: true
    });

    return this.ajax(this.buildURL(type.modelName), 'POST', {
      data: data
    }).then(function(json) {
      return Ember.merge(data, json);
    });
  },

  /**
   * Because Parse doesn't return a full set of properties on the
   * responses to updates, we want to perform a merge of the response
   * properties onto existing data so that the record maintains
   * latest data.
   */
  updateRecord: function(store, type, snapshot) {
    var serializer = store.serializerFor(type.modelName),
      id = snapshot.id,
      sendDeletes = false,
      deleteds = {},
      data = {},
      adapter = this;

    serializer.serializeIntoHash(data, type, snapshot, {
      includeId: true
    });

    type.eachRelationship(function(key) {
      if (data[key] && data[key].deleteds) {
        deleteds[key] = data[key].deleteds;
        delete data[key].deleteds;
        sendDeletes = true;
      }
    });

    return new Ember.RSVP.Promise(function(resolve, reject) {
      if (sendDeletes) {
        adapter.ajax(adapter.buildURL(type.modelName, id), 'PUT', {
          data: deleteds
        }).then(
          function() {
            adapter.ajax(adapter.buildURL(type.modelName, id), 'PUT', {
              data: data
            }).then(
              function(updates) {
                // This is the essential bit - merge response data onto existing data.
                resolve(Ember.merge(data, updates));
              },
              function(reason) {
                reject('Failed to save parent in relation: ' + reason.response.JSON);
              }
            );
          }, reject);

      } else {
        adapter.ajax(adapter.buildURL(type.modelName, id), 'PUT', {
          data: data
        }).then(
          function(json) {
            // This is the essential bit - merge response data onto existing data.
            resolve(Ember.merge(data, json));
          }, reject);
      }
    });
  },

  parseClassName: function(key) {
    return Ember.String.capitalize(key);
  },

  find: function(store, type, id, snapshot) {
    var query = {};

    this.inlcudeRelationships(store, type, query);

    return this.ajax(this.buildURL(type.modelName, id, snapshot), 'GET', {
      data: query
    });
  },

  findAll: function(store, type, sinceToken) {
    var query = {};

    this.inlcudeRelationships(store, type, query);

    if (sinceToken) {
      query.since = sinceToken;
    }

    return this.ajax(this.buildURL(type.modelName), 'GET', {
      data: query
    });
  },

  /**
   * Implementation of findQuery that automatically wraps query in a
   * JSON string.
   *
   * @example
   *     this.store.find('comment', {
   *       where: {
   *         post: {
   *             "__type":  "Pointer",
   *             "className": "Post",
   *             "objectId": post.get('id')
   *         }
   *       }
   *     });
   */
  query: function(store, type, query) {
    if (this.sortQueryParams) {
      query = this.sortQueryParams(query);
    }

    this.inlcudeRelationships(store, type, query);

    if (query.where && 'string' !== Ember.typeOf(query.where)) {
      query.where = JSON.stringify(query.where);
    }

    return this.ajax(this.buildURL(type.modelName), 'GET', {
      data: query
    });
  },

  /**
   * Implementation of a hasMany that provides a Relation query for Parse
   * objects.
   */
  findHasMany: function(store, record, relatedInfo) {
    const relatedInfo_ = JSON.parse(relatedInfo);
    const query = {
        where: {
          '$relatedTo': {
            'object': {
              '__type': 'Pointer',
              'className': this.parseClassName(record.typeKey),
              'objectId': Ember.get(record, 'id')
            },
            key: relatedInfo_.key
          }
        }
      };

    // the request is to the related type and not the type for the record.
    // the query is where there is a pointer to this record.
    return this.ajax(this.buildURL(relatedInfo_.typeKey), "GET", {
      data: query
    });
  },

  /**
   * Inlcudes the Pointers that are not set as `async` in the
   * query.
   *
   */
  inlcudeRelationships: function(store, type, query) {
    var includes = [];

    type.eachRelationship(function(name, descriptor) {
      var options = descriptor.options;

      if (options.async !== true && options.relationship !== true) {
        includes.push(name);
      }
    }, this);

    if (!Ember.isEmpty(includes)) {
      query.include = includes.join(',');
    }
  },

  headers: computed({
    get() {
        const headers = this.getWithDefault('_headers', {});

        return Ember.merge(headers, {
          'X-Parse-Application-Id': Ember.get(this, 'applicationId'),
          'X-Parse-REST-API-Key': Ember.get(this, 'restApiId')
        });
      },

      set(key, value) {
        this.set('_headers', value);
      }
  }),

  sessionToken: computed('headers.X-Parse-Session-Token', {
    get() {
        return this.get('headers.X-Parse-Session-Token');
      },

      set(key, value) {
        this.set('headers.X-Parse-Session-Token', value);
      }
  })
});