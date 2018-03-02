import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import { IntervalObservable } from 'rxjs/observable/IntervalObservable';
import 'rxjs/add/observable/forkJoin';
import 'rxjs/add/observable/of';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/first';
import 'rxjs/add/operator/mergeMap';
import { Wallet } from '../app.datatypes';

@Injectable()
export class WalletService {

  recentTransactions: Subject<any[]> = new BehaviorSubject<any[]>([]);
  transactions: Subject<any[]> = new BehaviorSubject<any[]>([]);
  wallets: Subject<Wallet[]> = new BehaviorSubject<Wallet[]>([]);

  constructor(
    private apiService: ApiService
  ) {
    this.loadData();
    IntervalObservable
      .create(30000)
      .subscribe(() => this.refreshBalances());
  }

  addressesAsString(): Observable<string> {
    return this.all().map(wallets => wallets.map(wallet => {
      return wallet.addresses.reduce((a, b) => {
        a.push(b.address);
        return a;
      }, []).join(',');
    }).join(','));
  }

  addAddress(wallet: Wallet) {
    return this.apiService.post('wallet/newAddress', {id: wallet.filename})
      .map(response => ({ address: response.addresses[0], coins: null, hours: null }));
  }

  all(): Observable<Wallet[]> {
    return this.wallets.asObservable();
  }

  allAddresses(): Observable<any[]> {
    return this.all().map(wallets => wallets.reduce((array, wallet) => array.concat(wallet.addresses), []));
  }

  create(label, seed, scan) {
    return this.apiService.post('wallet/create', {label: label ? label : 'undefined', seed: seed, scan: scan ? scan : 100})
      .do(wallet => {
        this.wallets.first().subscribe(wallets => {
          wallets.push(wallet);
          this.wallets.next(wallets);
          this.refreshBalances();
        });
      });
  }

  find(filename: string): Observable<Wallet> {
    return this.all().map(wallets => wallets.find(wallet => wallet.filename === filename));
  }

  folder(): Observable<string> {
    return this.apiService.get('wallets/folderName').map(response => response.address);
  }

  generateSeed(): Observable<string> {
    return this.apiService.get('wallet/newSeed').map(response => response.seed);
  }

  history(): Observable<any[]> {
    return this.transactions.asObservable();
  }

  outputs(): Observable<any> {
    return this.addressesAsString()
      .filter(addresses => !!addresses)
      .flatMap(addresses => this.apiService.get('outputs', {addrs: addresses}));
  }

  pendingTransactions(): Observable<any> {
    return this.apiService.get('pendingTxs');
  }

  recent(): Observable<any[]> {
    return this.recentTransactions.asObservable();
  }

  refreshBalances() {
    this.wallets.first().subscribe(wallets => {
      Observable.forkJoin(wallets.map(wallet => this.retrieveWalletBalance(wallet).map(response => {
        wallet.addresses = response;
        wallet.coins = response.map(address => address.coins >= 0 ? address.coins : 0).reduce((a , b) => a + b, 0);
        wallet.hours = response.map(address => address.hours >= 0 ? address.hours : 0).reduce((a , b) => a + b, 0);
        return wallet;
      })))
        .subscribe(newWallets => this.wallets.next(newWallets));
    });
  }

  renameWallet(wallet: Wallet, label: string): Observable<Wallet> {
    return this.apiService.post('wallet/update', { id: wallet.filename, label: label });
  }

  retrieveUpdatedTransactions(transactions) {
    return Observable.forkJoin((transactions.map(transaction => {
      return this.apiService.get('transaction', { txid: transaction.id }).map(response => {
        response.amount = transaction.amount;
        response.address = transaction.address;
        return response;
      });
    })));
  }

  sendSkycoin(wallet_id: string, address: string, amount: number) {
    return this.apiService.post('wallet/spend', {id: wallet_id, dst: address, coins: amount})
      .do(output => this.recentTransactions.first().subscribe(transactions => {
        const transaction = {id: output.txn.txid, address: address, amount: amount / 1000000};
        transactions.push(transaction);
        this.recentTransactions.next(transactions);
      }));
  }

  sum(): Observable<number> {
    return this.all().map(wallets => wallets.map(wallet => wallet.coins >= 0 ? wallet.coins : 0).reduce((a , b) => a + b, 0));
  }

  transaction(txid: string): Observable<any> {
    return this.apiService.get('transaction', {txid: txid}).flatMap(transaction => {
      if (transaction.txn.inputs && !transaction.txn.inputs.length) {
        return Observable.of(transaction);
      }
      return Observable.forkJoin(transaction.txn.inputs.map(input => this.retrieveInputAddress(input).map(response => {
        return response.owner_address;
      }))).map(inputs => {
        transaction.txn.inputs = inputs;
        return transaction;
      });
    });
  }

  private loadData(): void {
    this.apiService.getWallets().first().subscribe(wallets => {
      this.wallets.next(wallets);
      this.refreshBalances();
      // this.retrieveHistory();
      this.retrieveTransactions();
    });
  }

  private retrieveAddressBalance(address: any|any[]) {
    const addresses = Array.isArray(address) ? address.map(address => address.address).join(',') : address.address;
    return this.apiService.get('balance', {addrs: addresses});
  }

  private retrieveAddressTransactions(address: any) {
    return this.apiService.get('explorer/address', {address: address.address});
  }

  private retrieveInputAddress(input: string) {
    return this.apiService.get('uxout', {uxid: input});
  }

  private retrieveTransactions() {
    return this.wallets.first().subscribe(wallets => {
      Observable.forkJoin(wallets.map(wallet => this.retrieveWalletTransactions(wallet)))
        .map(transactions => [].concat.apply([], transactions).sort((a, b) =>  b.timestamp - a.timestamp))
        .map(transactions => transactions.reduce((array, item) => {
          if (!array.find(trans => trans.txid === item.txid)) {
            array.push(item);
          }
          return array;
        }, []))
        .subscribe(transactions => this.transactions.next(transactions));
    });
  }

  private retrieveWalletBalance(wallet: Wallet): Observable<any> {
    return Observable.forkJoin(wallet.addresses.map(address => this.retrieveAddressBalance(address).map(balance => {
      address.coins = balance.confirmed.coins;
      address.hours = balance.confirmed.hours;
      return address;
    })));
  }

  private retrieveWalletTransactions(wallet: Wallet) {
    return Observable.forkJoin(wallet.addresses.map(address => this.retrieveAddressTransactions(address)))
      .map(addresses => [].concat.apply([], addresses));
  }

  private retrieveWalletUnconfirmedTransactions(wallet: Wallet) {
    return this.apiService.get('wallet/transactions', {id: wallet.filename});
  }
}
