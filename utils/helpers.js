const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class Helpers {
  static generateId() {
    return uuidv4();
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static formatCurrency(amount, currency = 'USD') {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    });
    return formatter.format(amount);
  }

  static formatDate(date, format = 'YYYY-MM-DD') {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    let result = format;
    result = result.replace('YYYY', year).replace('MM', month).replace('DD', day);
    result = result.replace('HH', hours).replace('mm', minutes);
    return result;
  }

  static roundTo(value, decimals = 2) {
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  static deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  static countWords(text) {
    return text.trim().split(/\s+/).length;
  }

  static estimateReadingTime(text, wpm = 200) {
    const words = this.countWords(text);
    return Math.max(1, Math.ceil(words / wpm));
  }

  static truncateString(str, length = 100, suffix = '...') {
    if (str.length <= length) return str;
    return str.substring(0, length - suffix.length) + suffix;
  }

  static capitalize(str) {
    if (!str || str.length === 0) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  static toTitleCase(str) {
    return str.toLowerCase().split(' ').map(word => this.capitalize(word)).join(' ');
  }

  static getTimeDifference(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = Math.abs(end - start);
    return {
      milliseconds: diffMs,
      seconds: Math.floor(diffMs / 1000),
      minutes: Math.floor(diffMs / (1000 * 60)),
      hours: Math.floor(diffMs / (1000 * 60 * 60)),
      days: Math.floor(diffMs / (1000 * 60 * 60 * 24))
    };
  }

  static groupArrayBy(array, keyField) {
    return array.reduce((grouped, item) => {
      const key = item[keyField];
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
      return grouped;
    }, {});
  }

  static sortArray(array, field, direction = 'asc') {
    const sorted = [...array];
    sorted.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  static mergeObjects(target, source) {
    return { ...target, ...source };
  }
}

module.exports = Helpers;
