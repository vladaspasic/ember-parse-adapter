import Ember from 'ember';
import DS from 'ember-data';

export default DS.RESTSerializer.reopen({

  /**
   * Generate a type name from Parse Class name
   *
   * @method typeForRoot
   * @param  {String} key
   * @return {String}
   */
  typeForRoot: function(key) {
    return Ember.String.dasherize(Ember.String.singularize(key));
  },

  /**
   * Generate a Parse Class name from a model name
   *
   * @method parseClassName
   * @param  {String} key
   * @return {String}
   */
  parseClassName: function(key) {
    if ('parseUser' === key) {
      return '_User';

    } else {
      return Ember.String.capitalize(Ember.String.camelize(key));
    }
  },

  _normalizeResponse(store, modelClass, payload, id, requestType, isSingle) {
    let documentHash = {
      data: null,
      included: []
    };

    let meta = this.extractMeta(store, modelClass, payload);

    if (meta) {
      Ember.assert('The `meta` returned from `extractMeta` has to be an object, not "' +
        Ember.typeOf(meta) + '".', Ember.typeOf(meta) === 'object');

      documentHash.meta = meta;
    }

    let normalized;

    if (isSingle) {
      normalized = this._normalizePolymorphicRecord(store, payload, null, modelClass, this);
    } else {
      normalized = this._normalizeArray(store, modelClass.modelName, payload.results, null);
    }

    documentHash.data = normalized.data;
    if (normalized.included) {
      documentHash.included.push(...normalized.included);
    }

    return documentHash;
  },

  /**
   * Extracts count from the payload so that you can get the total number
   * of records in Parse if you're using skip and limit.
   */
  extractMeta: function(store, type, payload) {
    if (payload && payload.count) {
      store.setMetadataFor(type, {
        count: payload.count
      });
      delete payload.count;
    }
  },

  /**
   * Special handling of the Parse relation types. In certain
   * conditions there is a secondary query to retrieve the "many"
   * side of the "hasMany".
   */
  extractRelationships: function(type, hash) {
    const relationships = {};

    type.eachRelationship(function(key, relationshipMeta) {
      let relationship = null;
      let relationshipKey = this.keyForRelationship(key, relationshipMeta.kind, 'deserialize');
      let options = relationshipMeta.options;

      if (hash.hasOwnProperty(relationshipKey)) {
        let relationshipHash = hash[relationshipKey];
        let data;

        if (relationshipMeta.kind === 'belongsTo') {
          if (options.polymorphic) {
            data = this.extractPolymorphicRelationship(relationshipMeta.type, relationshipHash, {
              key, hash, relationshipMeta
            });
          } else {
            data = this.extractRelationship(relationshipMeta.type, relationshipHash);
          }
        } else if (relationshipMeta.kind === 'hasMany') {
          if (Ember.isNone(relationshipHash)) {
            return;
          }

          if (options.related || options.relation) {

          }

          if (options.relation) {
            if (!hash.links) {
              hash.links = {};
            }

            hash.links[key] = JSON.stringify({
              modelName: relationshipMeta.type,
              key: key
            });
          }

          if (options.array && relationshipHash.length) {
            data = new Array(relationshipHash.length);

            for (let i = 0, l = relationshipHash.length; i < l; i++) {
              const item = relationshipHash[i];
              data[i] = this.extractRelationship(relationshipMeta.type, item);
            }
          }
        }

        if(data) {
          relationship = { data };
        }

        const linkKey = this.keyForLink(key, relationshipMeta.kind);

        if (hash.links && hash.links.hasOwnProperty(linkKey)) {
          const related = hash.links[linkKey];
          relationship = relationship || {};
          relationship.links = {
            related
          };
        }
      }

      if (relationship) {
        relationships[key] = relationship;
      }

    }, this);

    return relationships;
  },

  extractRelationship(relationshipModelName, relationshipHash) {
    if (Ember.isNone(relationshipHash)) {
      return null;
    }

    const store = this.get('store');
    const modelClass = store.modelFor(relationshipModelName);

    if ('Pointer' === relationshipHash.__type) {
      return {
        id: relationshipHash.objectId,
        type: relationshipModelName
      };
    } else {
      const data = this.normalize(modelClass, relationshipHash);
      const model = store.push(data);

      return {
        id: model.id,
        type: relationshipModelName
      };
    }
  },

  serializeIntoHash: function(hash, type, snapshot, options) {
    Ember.merge(hash, this.serialize(snapshot, options));
  },

  serializeAttribute: function(snapshot, json, key, attribute) {
    // These are Parse reserved properties and we won't send them.
    var keys = ['createdAt', 'updatedAt', 'emailVerified', 'sessionToken'];

    if (keys.indexOf(key) < 0) {
      this._super(snapshot, json, key, attribute);
    } else {
      delete json[key];
    }
  },

  serializeBelongsTo: function(snapshot, json, relationship) {
    var key = relationship.key,
      modelName = relationship.type.modelName,
      belongsToId = snapshot.belongsTo(relationship.key, {
        id: true
      });

    if (belongsToId) {
      json[key] = {
        '__type': 'Pointer',
        'className': this.parseClassName(modelName),
        'objectId': belongsToId
      };
    }
  },

  serializeHasMany: function(snapshot, json, relationship) {
    var key = relationship.key,
      hasMany = snapshot.hasMany(key),
      options = relationship.options;

    // If this is a related relation do not sent any payload for this key
    if (options.related) {
      return;
    }

    if (hasMany) {
      json[key] = {
        'objects': []
      };

      if (options.relation) {
        json[key].__op = 'AddRelation';
      }

      if (options.array) {
        json[key].__op = 'AddUnique';
      }

      hasMany.forEach(function(child) {
        json[key].objects.push({
          '__type': 'Pointer',
          'className': this.parseClassName(child.type.modelName),
          'objectId': child.id
        });
      }, this);

      if (hasMany._deletedItems && hasMany._deletedItems.length) {
        if (options.relation) {
          var addOperation = json[key],
            deleteOperation = {
              '__op': 'RemoveRelation',
              'objects': []
            };

          hasMany._deletedItems.forEach(function(item) {
            deleteOperation.objects.push({
              '__type': 'Pointer',
              'className': item.type,
              'objectId': item.id
            });
          });

          json[key] = {
            '__op': 'Batch',
            'ops': [addOperation, deleteOperation]
          };
        }

        if (options.array) {
          json[key].deleteds = {
            '__op': 'Remove',
            'objects': []
          };

          hasMany._deletedItems.forEach(function(item) {
            json[key].deleteds.objects.push({
              '__type': 'Pointer',
              'className': item.type,
              'objectId': item.id
            });
          });
        }
      }

    } else {
      json[key] = [];
    }
  }

});